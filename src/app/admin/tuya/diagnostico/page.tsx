import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { serverNow } from "@/lib/util/server-now";
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

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function diagnoseDevice(
  timestamps: string[],
  t: Translator,
): {
  status: "ok" | "irregular" | "down" | "no_data";
  reason: string;
} {
  if (timestamps.length === 0) {
    return { status: "no_data", reason: t("reasons.noSnapshots") };
  }
  const sorted = timestamps.slice().sort();
  const last = new Date(sorted[sorted.length - 1]).getTime();
  const sinceLastMin = (Date.now() - last) / 60000;
  if (sinceLastMin > 240) {
    return {
      status: "down",
      reason: t("reasons.lastSnapshotAgo", {
        hours: Math.round(sinceLastMin / 60),
      }),
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
        reason: t("reasons.fewSnapshotsWait", { count: recent.length }),
      };
    }
    return {
      status: "down",
      reason: t("reasons.fewSnapshots", { count: recent.length }),
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
      reason: t("reasons.avgGapHigh", { min: Math.round(avgGap) }),
    };
  }
  if (maxGap > 180) {
    return {
      status: "irregular",
      reason: t("reasons.maxGapIsolated", { hours: Math.round(maxGap / 60) }),
    };
  }
  if (avgGap >= 45 && avgGap <= 75) {
    return { status: "ok", reason: t("reasons.cronWorking") };
  }
  return {
    status: "irregular",
    reason: t("reasons.avgGap", { min: Math.round(avgGap) }),
  };
}

async function StatusBadge({ status }: { status: "ok" | "irregular" | "down" | "no_data" }) {
  const t = await getTranslations("adminTuyaDiag");
  if (status === "ok") {
    return (
      <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="mr-1 h-3 w-3" /> {t("status.ok")}
      </Badge>
    );
  }
  if (status === "irregular") {
    return (
      <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300">
        <AlertTriangle className="mr-1 h-3 w-3" /> {t("status.irregular")}
      </Badge>
    );
  }
  if (status === "down") {
    return (
      <Badge className="bg-red-500/20 text-red-700 dark:text-red-300">
        <XCircle className="mr-1 h-3 w-3" /> {t("status.down")}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      {t("status.noData")}
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
  t: Translator,
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
    const diag = diagnoseDevice(info.timestamps, t);
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
  const t = await getTranslations("adminTuyaDiag");
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
    t,
  );
  const energy = summarize(
    (energyRes.data ?? []) as never,
    t,
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
          {t("back")}
        </Link>
        <h1 className="mt-2 text-4xl">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      {/* WIK-161 v2: card resumen al top — mira cuántos devices fueron
          capturados en la HORA actual (rounded). Si el cron horario está
          firing, debería ser total/total. Si dice 0/total entonces la
          última hora no se ejecutó (cron caído o falló silenciosamente). */}
      <HealthSummary sensors={sensors} energy={energy} />

      <Section title={t("sections.sensors")} devices={sensors} expectedGapMin={60} />
      <Section title={t("sections.energy")} devices={energy} expectedGapMin={60} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("howToRead.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            {t.rich("howToRead.window", {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <p>
            {t.rich("howToRead.ok", {
              strong: (chunks) => <strong>{chunks}</strong>,
              code: (chunks) => <code>{chunks}</code>,
            })}
          </p>
          <p>
            {t.rich("howToRead.irregular", {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <p>
            {t.rich("howToRead.down", {
              strong: (chunks) => <strong>{chunks}</strong>,
              code: (chunks) => <code>{chunks}</code>,
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t.rich("howToRead.global", {
              em: (chunks) => <em>{chunks}</em>,
            })}
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
async function HealthSummary({
  sensors,
  energy,
}: {
  sensors: DeviceStat[];
  energy: DeviceStat[];
}) {
  const t = await getTranslations("adminTuyaDiag");
  const now = serverNow();
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
        label: t("status.ok"),
        className: "text-emerald-600 dark:text-emerald-400",
      };
    if (captured === 0)
      return {
        label: t("summary.down"),
        className: "text-red-600 dark:text-red-400",
      };
    return {
      label: t("summary.partial"),
      className: "text-amber-600 dark:text-amber-400",
    };
  }
  const sStatus = status(s.captured, s.total);
  const eStatus = status(e.captured, e.total);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("summary.title")}</CardTitle>
        <CardDescription>
          {t("summary.description", {
            time: format(hourStart, "HH:mm", { locale: es }),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t("sections.sensors")}
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
              {t("summary.missing", { count: s.missing })}
            </p>
          )}
        </div>
        <div className="rounded-md border p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t("sections.energy")}
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
              {t("summary.missing", { count: e.missing })}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

async function Section({
  title,
  devices,
  expectedGapMin,
}: {
  title: string;
  devices: DeviceStat[];
  expectedGapMin: number;
}) {
  const t = await getTranslations("adminTuyaDiag");
  if (devices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t("section.empty")}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          {t("section.deviceCount", {
            count: devices.length,
            expectedGapMin,
          })}
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
                <p className="font-medium">{d.name ?? t("device.unnamed")}</p>
                <p className="text-xs text-muted-foreground">{d.reason}</p>
              </div>
              <StatusBadge status={d.status} />
            </div>
            <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em]">{t("device.snapshots")}</p>
                <p className="text-foreground tabular-nums">
                  {d.countRecent} <span className="opacity-50">/ {d.count}</span>
                </p>
                <p className="text-[10px] opacity-60">{t("device.snapshotsSub")}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em]">{t("device.last")}</p>
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
                <p className="font-mono text-[10px] uppercase tracking-[0.16em]">{t("device.avgGap")}</p>
                <p className="text-foreground tabular-nums">
                  {d.avgGapRecent != null
                    ? t("device.minutes", { min: Math.round(d.avgGapRecent) })
                    : "—"}
                </p>
                <p className="text-[10px] opacity-60">
                  {t("device.globalPrefix")}{" "}
                  {d.avgGapGlobal != null
                    ? t("device.minutes", { min: Math.round(d.avgGapGlobal) })
                    : "—"}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em]">{t("device.maxGap")}</p>
                <p className="text-foreground tabular-nums">
                  {d.maxGapRecent != null
                    ? t("device.minutes", { min: Math.round(d.maxGapRecent) })
                    : "—"}
                </p>
                <p className="text-[10px] opacity-60">
                  {t("device.globalPrefix")}{" "}
                  {d.maxGapGlobal != null
                    ? t("device.minutes", { min: Math.round(d.maxGapGlobal) })
                    : "—"}
                </p>
              </div>
            </div>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                {t("device.viewRecent")}
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
                        ? t("device.gapMinutes", {
                            min: Math.round(r.gap_to_previous_min),
                          })
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
