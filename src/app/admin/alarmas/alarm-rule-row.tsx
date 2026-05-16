"use client";

import { useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Property, Room } from "@/lib/types";
import { deleteAlarmRule, toggleAlarmRule } from "./actions";
import { NewAlarmRuleDialog } from "./new-alarm-rule-dialog";

type Rule = {
  id: string;
  property_id: string | null;
  room_id: string | null;
  property_device_id: string | null;
  metric: "temperature_c" | "humidity_pct";
  operator: "gt" | "lt";
  threshold: number;
  debounce_minutes: number;
  enabled: boolean;
};

const METRIC_LABEL = {
  temperature_c: "Temperatura",
  humidity_pct: "Humedad",
} as const;

const UNIT = {
  temperature_c: "°C",
  humidity_pct: "%",
} as const;

export function AlarmRuleRow({
  rule,
  properties,
  rooms,
  sensors,
  propertyById,
  roomById,
}: {
  rule: Rule;
  properties: Pick<Property, "id" | "name">[];
  rooms: Pick<Room, "id" | "name" | "property_id">[];
  sensors: { id: string; tuya_device_name: string | null; property_id: string }[];
  propertyById: Map<string, Pick<Property, "id" | "name">>;
  roomById: Map<string, Pick<Room, "id" | "name" | "property_id">>;
}) {
  const [pending, startTransition] = useTransition();

  const scopeLabel = (() => {
    if (rule.property_device_id) {
      const s = sensors.find((x) => x.id === rule.property_device_id);
      return s ? `Sensor ${s.tuya_device_name ?? "?"}` : "Sensor (?)";
    }
    if (rule.room_id) {
      const r = roomById.get(rule.room_id);
      return r ? `Ambiente ${r.name}` : "Ambiente (?)";
    }
    if (rule.property_id) {
      const p = propertyById.get(rule.property_id);
      return p ? `Propiedad ${p.name}` : "Propiedad (?)";
    }
    return "Global";
  })();

  const op = rule.operator === "gt" ? ">" : "<";

  function onToggle() {
    startTransition(async () => {
      const r = await toggleAlarmRule(rule.id, !rule.enabled);
      if (r?.error) toast.error(r.error);
      else
        toast.success(rule.enabled ? "Regla deshabilitada." : "Regla habilitada.");
    });
  }

  function onDelete() {
    if (!confirm("¿Borrar esta regla? Los eventos asociados también se borran.")) return;
    startTransition(async () => {
      const r = await deleteAlarmRule(rule.id);
      if (r?.error) toast.error(r.error);
      else toast.success("Regla eliminada.");
    });
  }

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
        rule.enabled ? "" : "opacity-50"
      }`}
    >
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">
            {METRIC_LABEL[rule.metric]} {op}{" "}
            <span className="tabular-nums">
              {rule.threshold}
              {UNIT[rule.metric]}
            </span>
          </span>
          {!rule.enabled && (
            <Badge variant="secondary" className="text-[10px]">
              deshabilitada
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {scopeLabel} · debounce {rule.debounce_minutes} min
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" disabled={pending} />}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <NewAlarmRuleDialog
            properties={properties}
            rooms={rooms}
            sensors={sensors}
            initialRule={rule}
            trigger={
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                Editar
              </DropdownMenuItem>
            }
          />
          <DropdownMenuItem onSelect={onToggle}>
            {rule.enabled ? "Deshabilitar" : "Habilitar"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onDelete}
            className="text-destructive focus:text-destructive"
          >
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
