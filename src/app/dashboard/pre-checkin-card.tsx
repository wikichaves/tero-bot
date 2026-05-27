import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Thermometer, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { serverNow } from "@/lib/util/server-now";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCurrentTempForProperty } from "@/lib/pre-checkin/current-temp";

/**
 * Server component card que muestra las próximas reservas (hoy + mañana)
 * con su estado de pre-checkin climate conditioning (WIK-125).
 *
 * Por cada reserva muestra:
 *   - Property + horario
 *   - Temp actual de la property (avg sensores ultima 30min)
 *   - Estado del flow:
 *       sin tracking → "Pendiente eval" (cron aún no llegó)
 *       no_action_needed → "✓ Ambiente OK"
 *       alert_sent_2h → "⏳ Esperando respuesta gestor"
 *       gestor_responded_no → "Gestor dijo no"
 *       started → "🔥 Acondicionando"
 *       check_1h_done / check_0h_done → "✓ Listo"
 *       quiet_hours_skipped → "Pospuesto (horario nocturno)"
 *
 * Si el cron aún no ha corrido la temp es la actual del sensor.
 */

type Row = {
  id: string;
  property_id: string;
  guest_name: string | null;
  check_in: string;
  check_in_time: string | null;
  property: {
    id: string;
    name: string;
    target_temp_min_c: number | null;
    target_temp_max_c: number | null;
  } | null;
  tracking: {
    stage: string;
    initial_temp_c: number | null;
  } | null;
};

const STAGE_LABEL: Record<string, { text: string; tone: "default" | "secondary" | "outline" }> = {
  no_action_needed: { text: "Ambiente OK", tone: "outline" },
  alert_sent_2h: { text: "Esperando respuesta", tone: "secondary" },
  gestor_responded_no: { text: "Sin acción", tone: "outline" },
  started: { text: "Acondicionando", tone: "default" },
  check_1h_done: { text: "En curso", tone: "default" },
  check_0h_done: { text: "Listo", tone: "default" },
  cancelled: { text: "Cancelado", tone: "outline" },
  no_response: { text: "Sin respuesta", tone: "outline" },
  quiet_hours_skipped: { text: "Pospuesto (noche)", tone: "outline" },
};

export async function PreCheckinCard() {
  const supabase = await createClient();
  const nowMs = serverNow();
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const tomorrowIso = new Date(nowMs + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data } = await supabase
    .from("reservations")
    .select(
      "id, property_id, guest_name, check_in, check_in_time, " +
        "property:properties(id, name, target_temp_min_c, target_temp_max_c), " +
        "tracking:pre_checkin_conditioning(stage, initial_temp_c)",
    )
    .eq("status", "confirmed")
    .in("check_in", [todayIso, tomorrowIso])
    .order("check_in", { ascending: true })
    .order("check_in_time", { ascending: true, nullsFirst: false });

  const rows = ((data ?? []) as unknown) as Row[];
  // Filter to properties that have at least target temps set — otherwise
  // the row is meaningless for this card.
  const relevant = rows.filter(
    (r) => r.property?.target_temp_min_c != null && r.property?.target_temp_max_c != null,
  );

  if (relevant.length === 0) {
    return null; // hide the card entirely
  }

  // Fetch current temp for each property in parallel.
  const temps = await Promise.all(
    relevant.map((r) =>
      r.property
        ? getCurrentTempForProperty(r.property.id)
        : Promise.resolve({ temp_c: null, humidity_pct: null, sensors_count: 0 }),
    ),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Thermometer className="h-4 w-4" />
          Pre check-ins
        </CardTitle>
        <CardDescription>
          Acondicionamiento ambiental antes del próximo check-in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {relevant.map((r, i) => {
          const tracking = (Array.isArray(r.tracking) ? r.tracking[0] : r.tracking) as
            | Row["tracking"]
            | undefined;
          const stage = tracking?.stage ?? "pending_eval";
          const stageInfo =
            STAGE_LABEL[stage] ?? { text: "Pendiente eval", tone: "secondary" as const };
          const currentTemp = temps[i]?.temp_c;
          const min = r.property?.target_temp_min_c;
          const max = r.property?.target_temp_max_c;
          const inRange =
            currentTemp != null &&
            min != null &&
            max != null &&
            currentTemp >= min &&
            currentTemp <= max;
          const Icon = inRange
            ? CheckCircle2
            : stage === "alert_sent_2h"
              ? Clock
              : stage === "started" || stage === "check_1h_done" || stage === "check_0h_done"
                ? Thermometer
                : AlertCircle;
          const checkInDate = parseISO(r.check_in);
          const timeLabel = r.check_in_time
            ? `${format(checkInDate, "EEE d MMM", { locale: es })} · ${r.check_in_time.slice(0, 5)}`
            : `${format(checkInDate, "EEE d MMM", { locale: es })}`;
          return (
            <div key={r.id} className="flex items-start gap-3 rounded-md border bg-card/50 p-2.5">
              <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div className="flex-1 space-y-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium">{r.property?.name ?? "—"}</p>
                  <Badge variant={stageInfo.tone} className="text-[10px]">
                    {stageInfo.text}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.guest_name ?? "Sin nombre"} · {timeLabel}
                </p>
                <p className="text-xs">
                  Temp actual:{" "}
                  <span className={inRange ? "text-emerald-600" : "text-amber-600"}>
                    {currentTemp != null ? `${currentTemp}°C` : "—"}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · target {min}°–{max}°
                  </span>
                  {tracking?.initial_temp_c != null && (
                    <span className="text-muted-foreground">
                      {" "}
                      · inició en {tracking.initial_temp_c}°
                    </span>
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
