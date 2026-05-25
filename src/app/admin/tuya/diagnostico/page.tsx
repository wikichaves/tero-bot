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
 * Status (mirando solo las ÚLTIMAS 24h para evitar contaminación con
 * historia vieja, ej. cuando el cron era diario o estaba en Hobby):
 *   - 🟢 OK: avg gap reciente entre 45-75min
 *   - 🟡 Irregular: gap razonable pero algún hueco >3h
 *   - 🔴 Caído: último snapshot >4h o gap reciente >2h
 *
 * WIK-161 v2: agregado el "Resumen actual" card al top que cuenta cuántos
 * devices fueron capturados en la última hora redondeada. Es el indicador
 * más útil para ver si el cron horario está firing — si el number es
 * total/total, todo OK.
 */

export const dynamic = "force-dynamic";

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

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

  // Sólo miramos los snapshots de las ÚLTIMAS 24h para evaluar status.
  // El avg global incluye historia de cuando el cron era diario (Hobby)
  // y sesga la lectura hacia "caído" aunque el cron horario ya funcione.
  const recentCutoff = Date.now() - RECENT_WINDOW_MS;
  const recent = sorted.filter(
    (t) => new Date(t).getTime() >= recentCutoff,
  );

  if (recent.length < 2) {
    if (sinceLastMin < 75) {
      // El último snapshot es reciente pero no hay suficiente historia
      // en 24h para evaluar — el cron quizás arrancó hace poco.
      return {
        status: "irregular",
        reason: `Solo ${recent.length} snapshot${recent.length === 1 ? "" : "s"} en últimas 24h — esperá unas horas`,
      };
    }
    return {
      status: "down",
      reason: `Solo ${recent.length} snapshot${recent.length === 1 ? "" : "s"} en últimas 24h`,
    };
  }

  // Gap entre snapshots recientes (minutos).
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    gaps.push(
      (new Date(recent[i]).getTime() - new Date(recent[i - 1]).getTime()) /
        60000,
    );
  }
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const maxGap = Math.max(...gaps);
  if (avgGap > 120) {
    return {
      status: "down",
      reason: `Gap promedio (24h) ${Math.round(avgGap)}min — esperado ~60min`,
    };
  }
  if (maxGap > 180) {
    return {
      status: "irregular",
      reason: `Gap reciente máximo ${Math.round(maxGap / 60)}h — algún fallo aislado`,
    };
  }
  if (avgGap >= 45 && avgGap <= 75) {
    return { status: "ok", reason: "Cron horario funcionando" };
  }
  return {
    status: "irregular",
    reason: `Gap promedio (24h) ${Math.round(avgGap)}min`,
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
  countRecent: number;
  first: string | null;
  last: string | null;
  /** Avg/max gap mirando SOLO las últimas 24h. Estos son los que matter. */
  avgGapRecent: number | null;
  maxGapRecent: number | null;
  /** Avg/max gap global (todos los snapshots). Para contexto histórico. */
  avgGapGlobal: number | null;
  maxGapGlobal: number | null;
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
    // Stats globales.
    const gapsGlobal: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gapsGlobal.push(
        (new Date(sorted[i]).getTime() -
          new Date(sorted[i - 1]).getTime()) /
          60000,
      );
    }
    const avgGapGlobal =
      gapsGlobal.length > 0
        ? gapsGlobal.reduce((a, b) => a + b, 0) / gapsGlobal.length
        : null;
    const maxGapGlobal =
      gapsGlobal.length > 0 ? Math.max(...gapsGlobal) : null;
    // Stats recientes (últimas 24h).
    const recentCutoff = Date.now() - RECENT_WINDOW_MS;
    const recentSorted = sorted.filter(
      (t) => new Date(t).getTime() >= recentCutoff,
    );
    const gapsRecent: number[] = [];
    for (let i = 1; i < recentSorted.length; i++) {
      gapsRecent.push(
        (new Date(recentSorted[i]).getTime() -
          new Date(recentSorted[i - 1]).getTime()) /
          60000,
      );
    }
    const avgGapRecent =
      gapsRecent.length > 0
        ? gapsRecent.reduce((a, b) => a + b, 0) / gapsRecent.length
        : null;
    const maxGapRecent =
      gapsRecent.length > 0 ? Math.max(...gapsRecent) : null;
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
      countRecent: recentSorted.length,
      first: sorted[0] ?? null,
      last: sorted[sorted.length - 1] ?? null,
      avgGapRecent,
      maxGapRecent,
      avgGapGlobal,
      maxGapGlobal,
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
        <h1 className="mt-2 text-2xl">Diagnóstico de captura</h1>
        <p className="text-sm text-muted-foreground">
          Salud del cron horario por device. Se computa con los últimos 200
          snapshots por tabla.
        </p>
      </div>

      {/* WIK-161 v2: card resumen al top — mira cuántos devices fueron
          capturados en la HORA actual (rounded). Si el cron horario está
          firing, debería ser total/total. Si dice 0/total entonces la
          última hora no se ejecutó (cron caído o falló silenciosamente). */}
      <HealthSummary sensors={sensors} energy={energy} />

      <Section title="Sensores T/H" devices={sensors} expectedGapMin={60} />
      <Section title="Llaves de energía" devices={energy} expectedGapMin={60} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cómo interpretar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            El status se calcula con los snapshots de las{" "}
            <strong>últimas 24h</strong>, no con todo el historial. Esto
            evita que historia vieja (ej. cuando el cron era diario en
            Hobby) sesgue el diagnóstico hacia &ldquo;caído&rdquo;
            aunque el cron horario ya funcione.
          </p>
          <p>
            <strong>OK</strong>: gap promedio reciente entre 45 y 75 min
            — el cron Pro horario (<code>0 * * * *</code>) está corriendo
            bien.
          </p>
          <p>
            <strong>Irregular</strong>: gap razonable pero algún hueco
            &gt;3h — puede ser un fallo aislado del cron.
          </p>
          <p>
            <strong>Caído</strong>: último snapshot hace &gt;4h o gap
            reciente &gt;2h. Si todos los devices están caídos, revisá
            Vercel → Settings → Cron Jobs → <code>sensor-snapshot</code>{" "}
            / <code>energy-snapshot</code> para ver si está activo.
          </p>
          <p className="text-xs text-muted-foreground">
            Los stats <em>globales</em> (línea pequeña) incluyen toda la
            historia — son útiles para ver cuánto tiempo lleva acumulando
            data.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Card resumen al top (WIK-161 v2). Cuenta cuántos devices fueron
 * capturados en la HORA actual (rounded), separado por sensors / energy.
 * Es el indicator más útil al entrar a la página: si todos los devices
 * tienen captura esta hora, el cron está sano. Si no, alguno (o todo)
 * falló — ir al detalle de abajo para ver cuál.
 */
function HealthSummary({
  sensors,
  energy,
}: {
  sensors: DeviceStat[];
  energy: DeviceStat[];
}) {
  const now = Date.now();
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  const hourStartMs = hourStart.getTime();

  function summarize(devices: DeviceStat[]) {
    let capturedThisHour = 0;
    for (const d of devices) {
      if (!d.last) continue;
      const lastMs = new Date(d.last).getTime();
      if (lastMs >= hourStartMs) capturedThisHour++;
    }
    return {
      total: devices.length,
      captured: capturedThisHour,
      missing: devices.length - capturedThisHour,
    };
  }
  const s = summarize(sensors);
  const e = summarize(energy);

  function status(captured: number, total: number) {
    if (total === 0) return { label: "—", className: "text-muted-foreground" };
    if (captured === total)
      return {
        label: "OK",
        className: "text-emerald-600 dark:text-emerald-400",
      };
    if (captured === 0)
      return {
        label: "Caído",
        className: "text-red-600 dark:text-red-400",
      };
    return {
      label: "Parcial",
      className: "text-amber-600 dark:text-amber-400",
    };
  }
  const sStatus = status(s.captured, s.total);
  const eStatus = status(e.captured, e.total);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Resumen hora actual</CardTitle>
        <CardDescription>
          Devices capturados desde las{" "}
          {format(hourStart, "HH:mm", { locale: es })} (UTC local). Si el
          cron horario funciona, debería ser total/total para ambas categorías.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Sensores T/H
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-2xl tabular-nums">
              {s.captured}
              <span className="text-base text-muted-foreground">
                /{s.total}
              </span>
            </p>
            <span className={`text-sm font-medium ${sStatus.className}`}>
              {sStatus.label}
            </span>
          </div>
          {s.missing > 0 && s.total > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {s.missing} sin captura — ver detalle abajo
            </p>
          )}
        </div>
        <div className="rounded-md border p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Llaves de energía
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-2xl tabular-nums">
              {e.captured}
              <span className="text-base text-muted-foreground">
                /{e.total}
              </span>
            </p>
            <span className={`text-sm font-medium ${eStatus.className}`}>
              {eStatus.label}
            </span>
          </div>
          {e.missing > 0 && e.total > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {e.missing} sin captura — ver detalle abajo
            </p>
          )}
        </div>
      </CardContent>
    </Card>
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
                <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Snapshots</p>
                <p className="text-foreground tabular-nums">
                  {d.countRecent} <span className="opacity-50">/ {d.count}</span>
                </p>
                <p className="text-[10px] opacity-60">últ. 24h / total</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Último</p>
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
                <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Gap prom (24h)</p>
                <p className="text-foreground tabular-nums">
                  {d.avgGapRecent != null
                    ? `${Math.round(d.avgGapRecent)} min`
                    : "—"}
                </p>
                <p className="text-[10px] opacity-60">
                  global:{" "}
                  {d.avgGapGlobal != null
                    ? `${Math.round(d.avgGapGlobal)} min`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Gap máx (24h)</p>
                <p className="text-foreground tabular-nums">
                  {d.maxGapRecent != null
                    ? `${Math.round(d.maxGapRecent)} min`
                    : "—"}
                </p>
                <p className="text-[10px] opacity-60">
                  global:{" "}
                  {d.maxGapGlobal != null
                    ? `${Math.round(d.maxGapGlobal)} min`
                    : "—"}
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
