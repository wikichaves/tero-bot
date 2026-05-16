"use client";

import { useTransition } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Property, Room } from "@/lib/types";
import { resolveAlarmEvent } from "./actions";

type EventRow = {
  id: string;
  rule_id: string;
  property_device_id: string;
  fired_at: string;
  resolved_at: string | null;
  trigger_value: number;
  notified_via_whatsapp: boolean;
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
};

const UNIT = {
  temperature_c: "°C",
  humidity_pct: "%",
} as const;

export function AlarmEventRow({
  event,
}: {
  event: EventRow;
  // Las maps no se usan ahora porque el row trae todo joineado, pero
  // las dejamos en la signature por si después queremos linkear a
  // /ambientes/[id] o filtrar por property.
  propertyById?: Map<string, Pick<Property, "id" | "name">>;
  roomById?: Map<string, Pick<Room, "id" | "name" | "property_id">>;
}) {
  const [pending, startTransition] = useTransition();

  const metric = event.rule?.metric;
  const op = event.rule?.operator === "gt" ? ">" : "<";
  const value =
    metric === "temperature_c"
      ? `${event.trigger_value.toFixed(1)}${UNIT.temperature_c}`
      : `${event.trigger_value.toFixed(0)}${UNIT.humidity_pct ?? ""}`;
  const threshold =
    event.rule != null
      ? metric === "temperature_c"
        ? `${event.rule.threshold.toFixed(1)}${UNIT.temperature_c}`
        : `${event.rule.threshold.toFixed(0)}${UNIT.humidity_pct ?? ""}`
      : "";
  const location =
    event.property_device?.room?.name ??
    event.property_device?.property?.name ??
    "—";
  const sensorName = event.property_device?.tuya_device_name;

  const firedFmt = format(parseISO(event.fired_at), "d MMM HH:mm", {
    locale: es,
  });
  const resolvedFmt = event.resolved_at
    ? format(parseISO(event.resolved_at), "d MMM HH:mm", { locale: es })
    : null;

  function onResolve() {
    startTransition(async () => {
      const r = await resolveAlarmEvent(event.id);
      if (r?.error) toast.error(r.error);
      else toast.success("Alarma marcada resuelta.");
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium tabular-nums">
            {value} en {location}
          </span>
          <span className="text-xs text-muted-foreground">
            umbral {op} {threshold}
          </span>
          {event.notified_via_whatsapp && (
            <Badge variant="secondary" className="text-[10px]">
              notif WA
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {sensorName ? `${sensorName} · ` : ""}
          Inicio {firedFmt}
          {resolvedFmt ? ` · Resuelta ${resolvedFmt}` : ""}
        </span>
      </div>
      {!event.resolved_at && (
        <Button
          variant="outline"
          size="sm"
          onClick={onResolve}
          disabled={pending}
        >
          Resolver
        </Button>
      )}
    </div>
  );
}
