import Link from "next/link";
import { AlertTriangle, Thermometer, Droplet } from "lucide-react";
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
import { avg } from "@/lib/stats";
import { serverNow } from "@/lib/util/server-now";

/**
 * Widget de ambientes para /dashboard (WIK-82 Fase 4).
 *
 * Si hay alarm_events activos, los muestra como cards destacadas en
 * rojo con valor + ambiente + métrica que cruzó. Si no hay alarmas,
 * muestra un summary breve: cuántos sensores reportaron en la última
 * hora, total de ambientes monitoreados.
 *
 * Link "Ver todos →" siempre va a /rooms.
 */

const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;

const UNIT: Record<"temperature_c" | "humidity_pct", string> = {
  temperature_c: "°C",
  humidity_pct: "%",
};

export async function SensorAlarmsCard() {
  // WIK-94: scope por property en el widget — gestor solo ve alarmas
  // y sensores de sus properties asignadas.
  const profile = await requireProfile();
  const allowedIds = await getAllowedPropertyIds(profile);

  const supabase = await createClient();
  const since = new Date(serverNow() - TWENTY_FOUR_H_MS).toISOString();

  let eventsQ = supabase
    .from("alarm_events")
    .select(
      "id, fired_at, trigger_value, rule:alarm_rules(metric, operator, threshold), property_device:property_devices!inner(property_id, tuya_device_name, property:properties(name), room:rooms(name))",
    )
    .is("resolved_at", null)
    .order("fired_at", { ascending: false });
  if (allowedIds !== null) {
    eventsQ = eventsQ.in("property_device.property_id", allowedIds);
  }
  let sensorsQ = supabase
    .from("property_devices")
    .select("id, room_id, property_id, property:properties(id, name)")
    .eq("device_kind", "sensor");
  if (allowedIds !== null) {
    sensorsQ = sensorsQ.in("property_id", allowedIds);
  }
  // WIK-117: incluir temperature_c + humidity_pct para mostrar
  // promedios por property en el dashboard.
  const snapsQ = supabase
    .from("sensor_snapshots")
    .select("property_device_id, taken_at, temperature_c, humidity_pct")
    .gte("taken_at", since)
    .order("taken_at", { ascending: false })
    .limit(100_000);

  const [activeEventsRes, sensorsRes, recentSnapsRes] = await Promise.all([
    eventsQ,
    sensorsQ,
    snapsQ,
  ]);

  const events =
    (activeEventsRes.data ?? []) as unknown as Array<{
      id: string;
      fired_at: string;
      trigger_value: number;
      rule: {
        metric: "temperature_c" | "humidity_pct";
        operator: "gt" | "lt";
        threshold: number;
      } | null;
      property_device: {
        tuya_device_name: string | null;
        property: { name: string } | null;
        room: { name: string } | null;
      } | null;
    }>;

  const sensors = (sensorsRes.data ?? []) as unknown as Array<{
    id: string;
    room_id: string | null;
    property_id: string;
    property: { id: string; name: string } | null;
  }>;
  const recentSnaps = (recentSnapsRes.data ?? []) as Array<{
    property_device_id: string;
    temperature_c: number | null;
    humidity_pct: number | null;
  }>;
  const reportingDeviceIds = new Set(
    recentSnaps.map((s) => s.property_device_id),
  );
  const reportingSensors = sensors.filter((s) =>
    reportingDeviceIds.has(s.id),
  );
  const distinctRooms = new Set(
    reportingSensors.map((s) => s.room_id).filter(Boolean),
  );

  // WIK-117: promedios T/H por property en 24h. Mapeo device→property
  // para luego agrupar los snapshots.
  const propertyByDevice = new Map<string, { id: string; name: string }>();
  for (const s of sensors) {
    if (s.property) propertyByDevice.set(s.id, s.property);
  }
  type PropStats = { name: string; temps: number[]; hums: number[] };
  const propStats = new Map<string, PropStats>();
  for (const snap of recentSnaps) {
    const prop = propertyByDevice.get(snap.property_device_id);
    if (!prop) continue;
    const acc =
      propStats.get(prop.id) ??
      ({ name: prop.name, temps: [], hums: [] } as PropStats);
    if (snap.temperature_c != null)
      acc.temps.push(Number(snap.temperature_c));
    if (snap.humidity_pct != null) acc.hums.push(Number(snap.humidity_pct));
    propStats.set(prop.id, acc);
  }
  const propertyAverages = Array.from(propStats.entries())
    .map(([id, s]) => ({
      id,
      name: s.name,
      avgT: avg(s.temps),
      avgH: avg(s.hums),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Si no hay sensores configurados, no renderear nada.
  if (sensors.length === 0) return null;

  const hasAlarms = events.length > 0;

  const t = await getTranslations("dashboard.alarmsCard");
  return (
    <Card className={hasAlarms ? "border-destructive/40" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            {hasAlarms && (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            )}
            {t("title")}
          </span>
          <Link
            href="/rooms"
            className="text-sm font-normal text-muted-foreground hover:text-foreground"
          >
            {t("viewAll")}
          </Link>
        </CardTitle>
        <CardDescription>
          {hasAlarms ? (
            <span className="text-destructive">
              {t("activeAlarms", { n: events.length })}
            </span>
          ) : (
            t("reportingOk", {
              sensors: reportingSensors.length,
              rooms: distinctRooms.size,
            })
          )}
        </CardDescription>
      </CardHeader>
      {hasAlarms && (
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            {events.slice(0, 5).map((e) => {
              const metric = e.rule?.metric;
              const op = e.rule?.operator === "gt" ? ">" : "<";
              const u = metric ? UNIT[metric] : "";
              const v =
                metric === "temperature_c"
                  ? `${e.trigger_value.toFixed(1)}${u}`
                  : `${e.trigger_value.toFixed(0)}${u}`;
              const thr =
                metric === "temperature_c"
                  ? `${e.rule?.threshold.toFixed(1) ?? "?"}${u}`
                  : `${e.rule?.threshold.toFixed(0) ?? "?"}${u}`;
              const Icon = metric === "temperature_c" ? Thermometer : Droplet;
              const iconColor =
                metric === "temperature_c"
                  ? "text-orange-500"
                  : "text-blue-500";
              const location =
                e.property_device?.room?.name ??
                e.property_device?.property?.name ??
                "—";
              return (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0"
                >
                  <div className="flex flex-1 items-center gap-2">
                    <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
                    <div className="flex flex-col">
                      <span className="font-medium tabular-nums">
                        {v} en {location}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("thresholdLabel", { op, thr })}
                        {e.property_device?.tuya_device_name &&
                          ` · ${e.property_device.tuya_device_name}`}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
            {events.length > 5 && (
              <li className="pt-1 text-xs text-muted-foreground">
                {t("moreInAdmin", { n: events.length - 5 })}
                <Link href="/admin/alarms" className="underline">
                  /admin/alarms
                </Link>
              </li>
            )}
          </ul>
        </CardContent>
      )}
      {/* WIK-117: cuando NO hay alarmas, mostrar promedios T/H por
          property en 24h. Da un pulso rápido del estado de las casas
          sin tener que entrar a /rooms. */}
      {!hasAlarms && propertyAverages.length > 0 && (
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            {propertyAverages.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="font-medium">{p.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  <span className="text-orange-600 dark:text-orange-400">
                    {p.avgT != null ? `${p.avgT.toFixed(1)}°C` : "—"}
                  </span>
                  {" · "}
                  <span className="text-blue-600 dark:text-blue-400">
                    {p.avgH != null ? `${Math.round(p.avgH)}%` : "—"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
