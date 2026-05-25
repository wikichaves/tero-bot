import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { avg, percentile } from "@/lib/stats";
import { formatShortDateTime } from "@/lib/i18n/date";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RoomHistoryChart } from "./room-history-chart-wrapper";

/**
 * /rooms/[id] — detalle de un room con histórico T+H.
 *
 * Rango por default: últimas 24 horas (WIK-98). Query param
 * `?range=24h|7d|30d` cambia la ventana — chart re-render server-side
 * al pasar otra link.
 *
 * Si el room tiene múltiples sensores, mostramos cada uno con su propia
 * serie en el chart + cards de stats individuales. Por ahora promedio
 * sólo si hay 1 sensor; con varios se ven separados para no esconder
 * outliers.
 */

export const dynamic = "force-dynamic";

const RANGES = {
  "24h": { hours: 24 },
  "7d": { hours: 7 * 24 },
  "30d": { hours: 30 * 24 },
} as const;

type RangeKey = keyof typeof RANGES;

export default async function RoomDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  // requireRole en el layout.
  const { id } = await params;
  const sp = await searchParams;
  const range: RangeKey =
    sp.range === "7d" || sp.range === "30d" ? sp.range : "24h";

  const t = await getTranslations("roomDetail");
  const locale = await getLocale();
  const rangeLabel = t(`ranges.${range}` as const);

  const supabase = await createClient();
  const since = new Date(
    Date.now() - RANGES[range].hours * 60 * 60 * 1000,
  ).toISOString();

  const { data: room } = await supabase
    .from("rooms")
    .select("id, name, property_id, properties:property_id(id, name)")
    .eq("id", id)
    .single<{
      id: string;
      name: string;
      property_id: string;
      properties: { id: string; name: string } | null;
    }>();
  if (!room) notFound();

  const { data: devices } = await supabase
    .from("property_devices")
    .select("id, tuya_device_name")
    .eq("room_id", id)
    .eq("device_kind", "sensor");
  const sensors = devices ?? [];

  let snapshots: Array<{
    property_device_id: string;
    taken_at: string;
    temperature_c: number | null;
    humidity_pct: number | null;
  }> = [];
  if (sensors.length > 0) {
    // Limit explícito (WIK-98): Supabase default es 1000 rows. Para 30d
    // con captura horaria, 1 sensor genera ~720 rows; con 2-3 sensores
    // por room nos pasamos del default y la query trunca silenciosa —
    // el chart muestra sólo el primer pedazo de la ventana. 100k cubre
    // 30d × 12 sensores × 1 snapshot cada 5min con margen.
    const { data: snaps } = await supabase
      .from("sensor_snapshots")
      .select("property_device_id, taken_at, temperature_c, humidity_pct")
      .in(
        "property_device_id",
        sensors.map((s) => s.id),
      )
      .gte("taken_at", since)
      .order("taken_at", { ascending: true })
      .limit(100_000);
    snapshots = snaps ?? [];
  }

  // Stats por sensor (WIK-96): usamos percentiles p5/p95 para min/max
  // en vez del extreme min/max. Un único spike de lectura (sensor
  // arrancando frío, error transient) sesga el min/max raw varios
  // grados. p5/p95 filtra el 5% de outliers en cada cola y da una
  // lectura más representativa del rango "real" del ambiente.
  //
  // Para series cortas (<20 snapshots) caemos al min/max raw porque
  // los percentiles no son significativos con tan poca data.
  const statsByDevice = sensors.map((s) => {
    const series = snapshots.filter((sn) => sn.property_device_id === s.id);
    const temps = series
      .map((x) => x.temperature_c)
      .filter((v): v is number => v != null);
    const hums = series
      .map((x) => x.humidity_pct)
      .filter((v): v is number => v != null);
    return {
      sensor: s,
      count: series.length,
      tempMin: percentile(temps, 5),
      tempMax: percentile(temps, 95),
      tempAvg: avg(temps),
      humMin: percentile(hums, 5),
      humMax: percentile(hums, 95),
      humAvg: avg(hums),
    };
  });

  // ¿Cuál es el primer snapshot disponible? Si está significativamente
  // después del `since` esperado, el chart sólo cubre parte de la
  // ventana — mostramos un banner para que el user no piense que la
  // curva plana inicial es real, sino falta de data.
  // Threshold proporcional: 10% del rango. Para 24h son ~2.4h, para
  // 7d son ~17h, para 30d son ~3d. Threshold mínimo de 1h para que no
  // pite por gaps insignificantes.
  const firstSnapshot = snapshots[0];
  const firstSnapshotTs = firstSnapshot
    ? new Date(firstSnapshot.taken_at).getTime()
    : null;
  const sinceTs = new Date(since).getTime();
  const rangeMs = RANGES[range].hours * 60 * 60 * 1000;
  const HISTORICAL_GAP_THRESHOLD_MS = Math.max(
    60 * 60 * 1000,
    rangeMs * 0.1,
  );
  const hasIncompleteHistory =
    firstSnapshotTs != null &&
    firstSnapshotTs - sinceTs > HISTORICAL_GAP_THRESHOLD_MS;

  // Series para chart: una serie por sensor en este room (para no
  // promediar y esconder outliers).
  const chartSeries = sensors.map((s, idx) => ({
    label: s.tuya_device_name ?? t("sensorNumbered", { n: idx + 1 }),
    deviceId: s.id,
    points: snapshots
      .filter((sn) => sn.property_device_id === s.id)
      .map((sn) => ({
        ts: new Date(sn.taken_at).getTime(),
        t: sn.temperature_c,
        h: sn.humidity_pct,
      })),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/rooms"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Link>
        <h1 className="mt-2 text-2xl">{room.name}</h1>
        <p className="text-sm text-muted-foreground">
          {t("subtitle", {
            property: room.properties?.name ?? "—",
            sensorsLabel: t("sensorsCount", { n: sensors.length }),
            readingsLabel: t("readingsCount", { n: snapshots.length }),
            range: rangeLabel,
          })}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(RANGES) as RangeKey[]).map((r) => (
          <Link key={r} href={`/rooms/${id}?range=${r}`}>
            <Button
              variant={range === r ? "default" : "outline"}
              size="sm"
            >
              {t(`ranges.${r}` as const)}
            </Button>
          </Link>
        ))}
      </div>

      {sensors.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {t("noSensorsPre")}
            <Link href="/admin/tuya" className="underline">
              {t("noSensorsLink")}
            </Link>
            {t("noSensorsPost")}
          </CardContent>
        </Card>
      ) : snapshots.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {t("noReadingsPre", { range: rangeLabel })}
            <Link href="/admin/tuya" className="underline">
              {t("noReadingsLink")}
            </Link>
            {t("noReadingsPost")}
          </CardContent>
        </Card>
      ) : (
        <>
          {hasIncompleteHistory && firstSnapshotTs && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-medium">{t("partialTitle")}</p>
                <p className="opacity-80">
                  {t("partialBody", {
                    date: formatShortDateTime(
                      new Date(firstSnapshotTs),
                      locale,
                    ),
                  })}
                </p>
              </div>
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("chart.title")}</CardTitle>
              <CardDescription>
                {t("chart.description", { range: rangeLabel })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RoomHistoryChart
                series={chartSeries}
                windowStartMs={sinceTs}
                windowEndMs={Date.now()}
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {statsByDevice.map((s) => (
              <Card key={s.sensor.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {s.sensor.tuya_device_name ?? t("sensorFallback")}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {t("readingsCount", { n: s.count })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>
                    <p
                      className="text-xs text-muted-foreground"
                      title={t("tempTooltip")}
                    >
                      {t("temperature")}
                    </p>
                    <p className="tabular-nums">
                      {s.tempMin?.toFixed(1) ?? "—"}°C ·{" "}
                      <span className="text-foreground/70">{t("avgShort")}</span>{" "}
                      {s.tempAvg?.toFixed(1) ?? "—"}°C ·{" "}
                      {s.tempMax?.toFixed(1) ?? "—"}°C
                    </p>
                  </div>
                  <div>
                    <p
                      className="text-xs text-muted-foreground"
                      title={t("humTooltip")}
                    >
                      {t("humidity")}
                    </p>
                    <p className="tabular-nums">
                      {s.humMin?.toFixed(0) ?? "—"}% ·{" "}
                      <span className="text-foreground/70">{t("avgShort")}</span>{" "}
                      {s.humAvg?.toFixed(0) ?? "—"}% ·{" "}
                      {s.humMax?.toFixed(0) ?? "—"}%
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
