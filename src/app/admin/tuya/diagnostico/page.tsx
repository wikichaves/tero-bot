import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Diagnóstico de salud de captura de Tuya snapshots (WIK-98 debug).
 *
 * Muestra por cada device los timestamps de los últimos 200 snapshots
 * con los gaps entre ellos. Útil para confirmar si el cron horario
 * está corriendo o si los snapshots se capturan solo on-demand.
 *
 * Status:
 *   - 🟢 OK: avg gap entre 50-70min (cron horario funcionando)
 *   - 🟡 Irregular: avg gap razonable pero max >2h
 *   - 🔴 Caído: avg gap >2h o sin snapshots en últimas 4h
 */

export const dynamic = "force-dynamic";

function diagnoseDevice(timestamps: string[]): {
  status: "ok" | "irregular" | "down" | "no_data";
  reason: string;
} {
  if (timestamps.length === 0) {
    return { status: "no_data", reason: "Sin snapshots" };
  }
  const sorted = timestamps.slice().sort();
  const last = new Date(sorted[sorted.length - 1]).getTime();
  const sinceLastMin = (Date.now() - last) / 60000;
  if (sinceLastMin > 240) {
    return {
      status: "down",
      reason: `Último snapshot hace ${Math.round(sinceLastMin / 60)}h`,
    };
  }
  if (sorted.length < 2) {
    return { status: "irregular", reason: "Solo 1 snapshot — sin suficiente historial" };
  }
  // Gap entre snapshots consecutivos (en minutos).
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(
      (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) /
        60000,
    );
  }
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const maxGap = Math.max(...gaps);
  if (avgGap > 120) {
    return {
      status: "down",
      reason: `Gap promedio ${Math.round(avgGap)}min — esperado ~60min`,
    };
  }
  if (maxGap > 180) {
    return {
      status: "irregular",
      reason: `Hubo un gap de ${Math.round(maxGap / 60)}h — quizás el cron se atrasó`,
    };
  }
  if (avgGap >= 45 && avgGap <= 75) {
    return { status: "ok", reason: "Cron horario funcionando" };
  }
  return {
    status: "irregular",
    reason: `Gap promedio ${Math.round(avgGap)}min`,
  };
}

function StatusBadge({ status }: { status: "ok" | "irregular" | "down" | "no_data" }) {
  if (status === "ok") {
    return (
      <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="mr-1 h-3 w-3" /> OK
      </Badge>
    );
  }
  if (status === "irregular") {
    return (
      <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300">
        <AlertTriangle className="mr-1 h-3 w-3" /> Irregular
      </Badge>
    );
  }
  if (status === "down") {
    return (
      <Badge className="bg-red-500/20 text-red-700 dark:text-red-300">
        <XCircle className="mr-1 h-3 w-3" /> Caído
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      Sin datos
    </Badge>
  );
}

type DeviceStat = {
  property_device_id: string;
  name: string | null;
  count: number;
  first: string | null;
  last: string | null;
  avgGap: number | null;
  maxGap: number | null;
  status: ReturnType<typeof diagnoseDevice>["status"];
  reason: string;
  recent: Array<{ taken_at: string; gap_to_previous_min: number | null }>;
};

function summarize(
  rows: Array<{
    property_device_id: string;
    taken_at: string;
    property_device: { tuya_device_name: string | null } | null;
  }>,
): DeviceStat[] {
  const byDevice = new Map<
    string,
    { name: string | null; timestamps: string[] }
  >();
  for (const r of rows) {
    const entry = byDevice.get(r.property_device_id) ?? {
      name: r.property_device?.tuya_device_name ?? null,
      timestamps: [],
    };
    entry.timestamps.push(r.taken_at);
    byDevice.set(r.property_device_id, entry);
  }
  return Array.from(byDevice.entries()).map(([id, info]) => {
    const sorted = info.timestamps.slice().sort();
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(
        (new Date(sorted[i]).getTime() -
          new Date(sorted[i - 1]).getTime()) /
          60000,
      );
    }
    const avgGap =
      gaps.length > 0
        ? gaps.reduce((a, b) => a + b, 0) / gaps.length
        : null;
    const maxGap = gaps.length > 0 ? Math.max(...gaps) : null;
    const diag = diagnoseDevice(info.timestamps);
    const recent = sorted
      .slice(-15)
      .reverse()
      .map((t, i, arr) => {
        const next = arr[i + 1];
        const gapMin = next
          ? (new Date(t).getTime() - new Date(next).getTime()) / 60000
          : null;
        return { taken_at: t, gap_to_previous_min: gapMin };
      });
    return {
      property_device_id: id,
      name: info.name,
      count: info.timestamps.length,
      first: sorted[0] ?? null,
      last: sorted[sorted.length - 1] ?? null,
      avgGap,
      maxGap,
      status: diag.status,
      reason: diag.reason,
      recent,
    };
  });
}

export default async function DiagnosticoPage() {
  await requireRole(["admin"]);
  const admin = createAdminClient();

  const [sensorRes, energyRes] = await Promise.all([
    admin
      .from("sensor_snapshots")
      .select(
        "property_device_id, taken_at, property_device:property_devices(tuya_device_name)",
      )
      .order("taken_at", { ascending: false })
      .limit(200),
    admin
      .from("energy_snapshots")
      .select(
        "property_device_id, taken_at, property_device:property_devices(tuya_device_name)",
      )
      .order("taken_at", { ascending: false })
      .limit(200),
  ]);

  const sensors = summarize(
    (sensorRes.data ?? []) as never,
  );
  const energy = summarize(
    (energyRes.data ?? []) as never,
  );

  // Ordenar por status: caídos primero, después irregulares, después OK.
  const statusOrder = { down: 0, irregular: 1, ok: 2, no_data: 3 };
  sensors.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  energy.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin/tuya"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Diagnóstico de captura</h1>
        <p className="text-sm text-muted-foreground">
          Salud del cron horario por device. Se computa con los últimos 200
          snapshots por tabla.
        </p>
      </div>

      <Section title="Sensores T/H" devices={sensors} expectedGapMin={60} />
      <Section title="Llaves de energía" devices={energy} expectedGapMin={60} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cómo interpretar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>OK</strong>: gap promedio entre 45 y 75 min — el cron
            Pro horario (<code>0 * * * *</code>) está corriendo bien.
          </p>
          <p>
            <strong>Irregular</strong>: gap promedio razonable pero hubo
            algún hueco mayor a 3h — puede ser un fallo aislado del cron.
          </p>
          <p>
            <strong>Caído</strong>: último snapshot hace &gt;4h o gap
            promedio &gt;2h. Si todos los devices están caídos, revisá
            Vercel → Settings → Cron Jobs → <code>sensor-snapshot</code> /{" "}
            <code>energy-snapshot</code> para ver si el plan permite ese
            schedule.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Section({
  title,
  devices,
  expectedGapMin,
}: {
  title: string;
  devices: DeviceStat[];
  expectedGapMin: number;
}) {
  if (devices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Sin snapshots registrados.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          {devices.length} device{devices.length === 1 ? "" : "s"} ·
          esperado gap ~{expectedGapMin} min entre snapshots
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {devices.map((d) => (
          <div
            key={d.property_device_id}
            className="rounded-md border p-3 text-sm"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{d.name ?? "(sin nombre)"}</p>
                <p className="text-xs text-muted-foreground">{d.reason}</p>
              </div>
              <StatusBadge status={d.status} />
            </div>
            <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-4">
              <div>
                <p className="text-[10px] uppercase">Snapshots</p>
                <p className="text-foreground tabular-nums">{d.count}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase">Último</p>
                <p className="text-foreground">
                  {d.last
                    ? formatDistanceToNow(new Date(d.last), {
                        locale: es,
                        addSuffix: true,
                      })
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase">Gap promedio</p>
                <p className="text-foreground tabular-nums">
                  {d.avgGap != null ? `${Math.round(d.avgGap)} min` : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase">Gap máximo</p>
                <p className="text-foreground tabular-nums">
                  {d.maxGap != null ? `${Math.round(d.maxGap)} min` : "—"}
                </p>
              </div>
            </div>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Ver últimos 15 snapshots
              </summary>
              <ul className="mt-2 space-y-1 font-mono">
                {d.recent.map((r) => (
                  <li key={r.taken_at} className="flex justify-between gap-2">
                    <span>
                      {format(new Date(r.taken_at), "d MMM HH:mm", {
                        locale: es,
                      })}
                    </span>
                    <span className="text-muted-foreground">
                      {r.gap_to_previous_min != null
                        ? `+${Math.round(r.gap_to_previous_min)} min`
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
