"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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

type Metric = "temperature_c" | "humidity_pct" | "power_outage";
type ScopeType = "global" | "property" | "room" | "device";

export function NewAlarmRuleDialog({
  properties,
  rooms,
  sensors,
  profiles,
  initialRule,
  initialRecipientIds,
  trigger,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  properties: Pick<Property, "id" | "name">[];
  rooms: Pick<Room, "id" | "name" | "property_id">[];
  sensors: { id: string; tuya_device_name: string | null; property_id: string }[];
  /** WIK-275: todos los usuarios, para el checkbox group de destinatarios. */
  profiles: { id: string; full_name: string | null; email: string; role: string }[];
  /** WIK-275: ids ya asignados (edición). undefined = regla nueva → admins
   *  pre-chequeados por default. */
  initialRecipientIds?: string[];
  initialRule?: {
    id: string;
    property_id: string | null;
    room_id: string | null;
    property_device_id: string | null;
    metric: Metric;
    // WIK-280: nullable — las reglas power_outage no tienen operator/threshold.
    operator: "gt" | "lt" | null;
    threshold: number | null;
    debounce_minutes: number;
    enabled: boolean;
  };
  trigger?: React.ReactNode;
  /** Controlled open state. Si NO se pasa, el dialog gestiona su propio state
   *  con un trigger interno (modo "Nueva regla" desde la card de Alarmas).
   *  Si se pasa, el caller controla open/close — útil para abrir el dialog
   *  desde un dropdown menu item sin nestear DialogTrigger adentro del
   *  DropdownMenuItem (Base UI no se lleva bien con eso, ver WIK-88). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("adminAlarmDialog");
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChangeProp ?? setInternalOpen;
  const isControlled = openProp !== undefined;
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
  // WIK-275: destinatarios. Regla nueva → admins pre-chequeados por default.
  const [recipientIds, setRecipientIds] = useState<Set<string>>(() =>
    initialRecipientIds
      ? new Set(initialRecipientIds)
      : new Set(profiles.filter((p) => p.role === "admin").map((p) => p.id)),
  );

  function toggleRecipient(id: string) {
    setRecipientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // WIK-280: corte de luz no usa operator/threshold y siempre es por propiedad.
  const isOutage = metric === "power_outage";

  function changeMetric(m: Metric) {
    setMetric(m);
    if (m === "power_outage") {
      // El corte de luz se configura por propiedad — forzamos el scope.
      setScopeType("property");
      setScopeId(null);
      return;
    }
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
        // WIK-280: corte de luz no manda operator/threshold.
        operator: isOutage ? null : operator,
        threshold: isOutage ? null : Number(threshold),
        debounce_minutes: Number(debounce),
        enabled: initialRule?.enabled ?? true,
        recipient_profile_ids: Array.from(recipientIds),
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(initialRule ? t("toast.updated") : t("toast.created"));
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
      {/* En modo controlled (open/onOpenChange pasados por el caller) no
          rendereamos trigger interno — el caller dispara el dialog desde
          afuera. En modo uncontrolled, rendereamos "Nueva regla" o el
          trigger custom que nos pasen. */}
      {!isControlled && (
        <DialogTrigger render={trigger ? <span /> : <Button size="sm" />}>
          {trigger ?? (
            <>
              <Plus className="mr-1 h-4 w-4" />
              {t("newRule")}
            </>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {initialRule ? t("title.edit") : t("title.new")}
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label htmlFor="metric">{t("fields.metric")}</Label>
                <select
                  id="metric"
                  value={metric}
                  onChange={(e) => changeMetric(e.target.value as Metric)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                >
                  <option value="humidity_pct">{t("metricOptions.humidity")}</option>
                  <option value="temperature_c">{t("metricOptions.temperature")}</option>
                  <option value="power_outage">{t("metricOptions.powerOutage")}</option>
                </select>
              </div>
              {/* WIK-280: corte de luz no usa operador. */}
              {!isOutage && (
                <div className="grid gap-2">
                  <Label htmlFor="operator">{t("fields.operator")}</Label>
                  <select
                    id="operator"
                    value={operator}
                    onChange={(e) =>
                      setOperator(e.target.value as "gt" | "lt")
                    }
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                  >
                    <option value="gt">{t("operatorOptions.gt")}</option>
                    <option value="lt">{t("operatorOptions.lt")}</option>
                  </select>
                </div>
              )}
            </div>
            {isOutage && (
              <p className="text-xs text-muted-foreground">
                {t("powerOutageHint")}
              </p>
            )}
            {/* WIK-280/281: corte de luz no usa umbral ni debounce (la
                detección por fault DP es inmediata, no hay debounce aplicado). */}
            {!isOutage && (
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-2">
                  <Label htmlFor="threshold">{t("fields.threshold")}</Label>
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
                  <Label htmlFor="debounce">{t("fields.debounce")}</Label>
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
            )}
            {/* WIK-280: el corte de luz es siempre por propiedad → ocultamos
                el selector de scope (queda fijo en "property"). */}
            {!isOutage && (
              <div className="grid gap-2">
                <Label htmlFor="scope_type">{t("fields.scopeType")}</Label>
                <select
                  id="scope_type"
                  value={scopeType}
                  onChange={(e) => {
                    setScopeType(e.target.value as ScopeType);
                    setScopeId(null);
                  }}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                >
                  <option value="global">{t("scopeOptions.global")}</option>
                  <option value="property">{t("scopeOptions.property")}</option>
                  <option value="room">{t("scopeOptions.room")}</option>
                  <option value="device">{t("scopeOptions.device")}</option>
                </select>
              </div>
            )}
            {scopeType !== "global" && (
              <div className="grid gap-2">
                <Label htmlFor="scope_id">
                  {scopeType === "property"
                    ? t("scopeLabels.property")
                    : scopeType === "room"
                      ? t("scopeLabels.room")
                      : t("scopeLabels.device")}
                </Label>
                <select
                  id="scope_id"
                  value={scopeId ?? ""}
                  onChange={(e) => setScopeId(e.target.value || null)}
                  required
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                >
                  <option value="">{t("selectPlaceholder")}</option>
                  {scopeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {/* WIK-275: destinatarios de la alarma (checkbox group con todos
                los usuarios). Admin pre-chequeado por default en reglas
                nuevas. */}
            <div className="grid gap-2">
              <Label>{t("fields.recipients")}</Label>
              <div className="grid max-h-44 gap-1.5 overflow-y-auto">
                {profiles.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={recipientIds.has(p.id)}
                      onChange={() => toggleRecipient(p.id)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span>{p.full_name?.trim() || p.email}</span>
                    {p.role === "admin" && (
                      <span className="text-xs text-muted-foreground">
                        · admin
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("fields.recipientsHint")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending
                ? t("submit.saving")
                : initialRule
                  ? t("submit.update")
                  : t("submit.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
