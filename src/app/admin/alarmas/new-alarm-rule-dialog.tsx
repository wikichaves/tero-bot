"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Property, Room } from "@/lib/types";
import { saveAlarmRule } from "./actions";

type Metric = "temperature_c" | "humidity_pct";
type ScopeType = "global" | "property" | "room" | "device";

export function NewAlarmRuleDialog({
  properties,
  rooms,
  sensors,
  initialRule,
  trigger,
}: {
  properties: Pick<Property, "id" | "name">[];
  rooms: Pick<Room, "id" | "name" | "property_id">[];
  sensors: { id: string; tuya_device_name: string | null; property_id: string }[];
  initialRule?: {
    id: string;
    property_id: string | null;
    room_id: string | null;
    property_device_id: string | null;
    metric: Metric;
    operator: "gt" | "lt";
    threshold: number;
    debounce_minutes: number;
    enabled: boolean;
  };
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const initialScope: ScopeType = initialRule
    ? initialRule.property_device_id
      ? "device"
      : initialRule.room_id
        ? "room"
        : initialRule.property_id
          ? "property"
          : "global"
    : "global";
  const initialScopeId =
    initialRule?.property_device_id ??
    initialRule?.room_id ??
    initialRule?.property_id ??
    null;

  const [scopeType, setScopeType] = useState<ScopeType>(initialScope);
  const [scopeId, setScopeId] = useState<string | null>(initialScopeId);
  const [metric, setMetric] = useState<Metric>(
    initialRule?.metric ?? "humidity_pct",
  );
  const [operator, setOperator] = useState<"gt" | "lt">(
    initialRule?.operator ?? "gt",
  );
  const [threshold, setThreshold] = useState(
    String(initialRule?.threshold ?? (metric === "humidity_pct" ? 80 : 33)),
  );
  const [debounce, setDebounce] = useState(
    String(initialRule?.debounce_minutes ?? 15),
  );

  function changeMetric(m: Metric) {
    setMetric(m);
    // Sugerir threshold default si el usuario no editó.
    setThreshold((prev) =>
      prev === "80" || prev === "33"
        ? m === "humidity_pct"
          ? "80"
          : "33"
        : prev,
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveAlarmRule({
        id: initialRule?.id,
        scope_type: scopeType,
        scope_id: scopeType === "global" ? null : scopeId,
        metric,
        operator,
        threshold: Number(threshold),
        debounce_minutes: Number(debounce),
        enabled: initialRule?.enabled ?? true,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(initialRule ? "Regla actualizada." : "Regla creada.");
      setOpen(false);
    });
  }

  const scopeOptions = (() => {
    switch (scopeType) {
      case "property":
        return properties.map((p) => ({ value: p.id, label: p.name }));
      case "room":
        return rooms.map((r) => {
          const prop = properties.find((p) => p.id === r.property_id);
          return {
            value: r.id,
            label: prop ? `${r.name} · ${prop.name}` : r.name,
          };
        });
      case "device":
        return sensors.map((s) => {
          const prop = properties.find((p) => p.id === s.property_id);
          return {
            value: s.id,
            label: prop
              ? `${s.tuya_device_name ?? "?"} · ${prop.name}`
              : (s.tuya_device_name ?? "?"),
          };
        });
      default:
        return [];
    }
  })();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ? <span /> : <Button size="sm" />}>
        {trigger ?? (
          <>
            <Plus className="mr-1 h-4 w-4" />
            Nueva regla
          </>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {initialRule ? "Editar regla" : "Nueva regla de alarma"}
            </DialogTitle>
            <DialogDescription>
              Cuando un sensor reporta una lectura que cruza el umbral,
              dispara una alarma y notifica por WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label htmlFor="metric">Métrica</Label>
                <select
                  id="metric"
                  value={metric}
                  onChange={(e) => changeMetric(e.target.value as Metric)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                >
                  <option value="humidity_pct">Humedad (%)</option>
                  <option value="temperature_c">Temperatura (°C)</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="operator">Condición</Label>
                <select
                  id="operator"
                  value={operator}
                  onChange={(e) =>
                    setOperator(e.target.value as "gt" | "lt")
                  }
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                >
                  <option value="gt">Mayor que (&gt;)</option>
                  <option value="lt">Menor que (&lt;)</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label htmlFor="threshold">Umbral</Label>
                <Input
                  id="threshold"
                  type="number"
                  step="0.1"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="debounce">Debounce (min)</Label>
                <Input
                  id="debounce"
                  type="number"
                  step="1"
                  min="0"
                  max="1440"
                  value={debounce}
                  onChange={(e) => setDebounce(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="scope_type">Aplica a</Label>
              <select
                id="scope_type"
                value={scopeType}
                onChange={(e) => {
                  setScopeType(e.target.value as ScopeType);
                  setScopeId(null);
                }}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                <option value="global">Todos los sensores (global)</option>
                <option value="property">Una propiedad</option>
                <option value="room">Un ambiente</option>
                <option value="device">Un sensor específico</option>
              </select>
            </div>
            {scopeType !== "global" && (
              <div className="grid gap-2">
                <Label htmlFor="scope_id">
                  {scopeType === "property"
                    ? "Propiedad"
                    : scopeType === "room"
                      ? "Ambiente"
                      : "Sensor"}
                </Label>
                <select
                  id="scope_id"
                  value={scopeId ?? ""}
                  onChange={(e) => setScopeId(e.target.value || null)}
                  required
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                >
                  <option value="">— Seleccionar —</option>
                  {scopeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : initialRule ? "Actualizar" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
