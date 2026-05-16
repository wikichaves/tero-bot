import Link from "next/link";
import { AlertTriangle, Thermometer, Droplet } from "lucide-react";
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
 * Widget de ambientes para /dashboard (WIK-82 Fase 4).
 *
 * Si hay alarm_events activos, los muestra como cards destacadas en
 * rojo con valor + ambiente + métrica que cruzó. Si no hay alarmas,
 * muestra un summary breve: cuántos sensores reportaron en la última
 * hora, total de ambientes monitoreados.
 *
 * Link "Ver todos →" siempre va a /ambientes.
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
  const since = new Date(Date.now() - TWENTY_FOUR_H_MS).toISOString();

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
    .select("id, room_id, property_id")
    .eq("device_kind", "sensor");
  if (allowedIds !== null) {
    sensorsQ = sensorsQ.in("property_id", allowedIds);
  }
  const snapsQ = supabase
    .from("sensor_snapshots")
    .select("property_device_id, taken_at")
    .gte("taken_at", since)
    .order("taken_at", { ascending: false });

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

  const sensors = (sensorsRes.data ?? []) as Array<{
    id: string;
    room_id: string | null;
  }>;
  const recentSnaps = (recentSnapsRes.data ?? []) as Array<{
    property_device_id: string;
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

  // Si no hay sensores configurados, no renderear nada (el dashboard
  // se queda igual sin esta sección).
  if (sensors.length === 0) return null;

  const hasAlarms = events.length > 0;

  return (
    <Card className={hasAlarms ? "border-destructive/40" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            {hasAlarms && (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            )}
            Ambientes
          </span>
          <Link
            href="/ambientes"
            className="text-sm font-normal text-muted-foreground hover:text-foreground"
          >
            Ver todos →
          </Link>
        </CardTitle>
        <CardDescription>
          {hasAlarms ? (
            <span className="text-destructive">
              {events.length} alarma{events.length === 1 ? "" : "s"} activa
              {events.length === 1 ? "" : "s"}
            </span>
          ) : (
            <>
              {reportingSensors.length} sensor
              {reportingSensors.length === 1 ? "" : "es"} en{" "}
              {distinctRooms.size} ambiente
              {distinctRooms.size === 1 ? "" : "s"} reportando OK.
            </>
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
                        umbral {op} {thr}
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
                + {events.length - 5} más en{" "}
                <Link href="/admin/alarmas" className="underline">
                  /admin/alarmas
                </Link>
              </li>
            )}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
