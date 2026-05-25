import Link from "next/link";
import { Zap } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";

/**
 * Widget de energía para /dashboard (WIK-117).
 *
 * Muestra el consumo total agregado de las últimas 24h sobre todos
 * los devices del scope del user, con link a /energy. Para no
 * complicar con FX/locale, mostramos solo kWh — la conversión a
 * UYU/USD/ARS está en /energy donde el user puede elegir la unidad.
 *
 * Cálculo: por cada property_device energético, último snapshot -
 * primer snapshot dentro de la ventana = delta_kwh.
 */

export async function EnergySummaryCard() {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "gestor") {
    return null;
  }
  const allowedIds = await getAllowedPropertyIds(profile);
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Solo necesitamos saber los snapshots de las últimas 24h scoped.
  // El join filtra por property scope; si gestor sin properties → sin data.
  let snapsQ = supabase
    .from("energy_snapshots")
    .select(
      "property_device_id, taken_at, total_energy_kwh, property_device:property_devices!inner(property_id)",
    )
    .gte("taken_at", since)
    .not("total_energy_kwh", "is", null)
    .order("taken_at", { ascending: true })
    .limit(100_000);
  if (allowedIds !== null) {
    snapsQ = snapsQ.in("property_device.property_id", allowedIds);
  }
  const { data: snaps } = await snapsQ;
  const rows = (snaps ?? []) as Array<{
    property_device_id: string;
    taken_at: string;
    total_energy_kwh: number | null;
  }>;

  // Agrupar por device, computar delta (último - primero) por cada uno
  // y sumar todo.
  const byDevice = new Map<string, { first: number; last: number }>();
  for (const r of rows) {
    if (r.total_energy_kwh == null) continue;
    const v = Number(r.total_energy_kwh);
    const entry = byDevice.get(r.property_device_id);
    if (!entry) {
      byDevice.set(r.property_device_id, { first: v, last: v });
    } else {
      entry.last = v;
    }
  }
  let totalKwh = 0;
  for (const { first, last } of byDevice.values()) {
    const delta = last - first;
    if (delta > 0) totalKwh += delta;
  }

  const t = await getTranslations("dashboard.energyCard");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-orange-500" />
            {t("title")}
          </span>
          <Link
            href="/energy"
            className="text-sm font-normal text-muted-foreground hover:text-foreground"
          >
            {t("viewDetail")}
          </Link>
        </CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tabular-nums">
            {totalKwh > 0
              ? totalKwh.toLocaleString("es-UY", {
                  maximumFractionDigits: totalKwh < 10 ? 2 : 1,
                })
              : "—"}
          </span>
          <span className="text-sm text-muted-foreground">kWh</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {byDevice.size > 0 ? t("summary", { n: byDevice.size }) : t("noReadings")}
        </p>
      </CardContent>
    </Card>
  );
}
