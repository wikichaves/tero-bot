"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { DeviceKind, Property, PropertyDevice } from "@/lib/types";
import { assignDevice, unassignDevice } from "./actions";

const KIND_OPTIONS: { value: DeviceKind; labelKey: string }[] = [
  { value: "lock", labelKey: "kind.lock" },
  { value: "thermostat", labelKey: "kind.thermostat" },
  { value: "light", labelKey: "kind.light" },
  { value: "switch", labelKey: "kind.switch" },
  { value: "camera", labelKey: "kind.camera" },
  { value: "sensor", labelKey: "kind.sensor" },
  { value: "breaker", labelKey: "kind.breaker" },
  { value: "other", labelKey: "kind.other" },
];

export function AssignDeviceDialog({
  tuyaDeviceId,
  tuyaDeviceName,
  properties,
  current,
  suggestedKind,
  open,
  onOpenChange,
}: {
  tuyaDeviceId: string;
  tuyaDeviceName: string;
  properties: Pick<Property, "id" | "name">[];
  current: PropertyDevice | null;
  suggestedKind: DeviceKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("adminTuyaAssign");
  const [pending, startTransition] = useTransition();
  const [propertyId, setPropertyId] = useState(
    current?.property_id ?? properties[0]?.id ?? "",
  );
  const [kind, setKind] = useState<DeviceKind>(
    current?.device_kind ?? suggestedKind,
  );
  const [isPrimary, setIsPrimary] = useState(current?.is_primary ?? false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!propertyId) {
      toast.error(t("toast.pickProperty"));
      return;
    }
    startTransition(async () => {
      const result = await assignDevice({
        tuya_device_id: tuyaDeviceId,
        tuya_device_name: tuyaDeviceName,
        property_id: propertyId,
        device_kind: kind,
        is_primary: isPrimary,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toast.assigned"));
      onOpenChange(false);
    });
  }

  function onUnassign() {
    if (!confirm(t("confirmUnassign", { name: tuyaDeviceName }))) return;
    startTransition(async () => {
      const result = await unassignDevice(tuyaDeviceId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toast.unassigned"));
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {current ? t("title.edit") : t("title.assign")}
            </DialogTitle>
            <DialogDescription>
              {tuyaDeviceName} ·{" "}
              <span className="font-mono text-xs">{tuyaDeviceId}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="property_id">{t("fields.property")}</Label>
              <select
                id="property_id"
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                required
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                <option value="">{t("fields.propertyPlaceholder")}</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="device_kind">{t("fields.kind")}</Label>
              <select
                id="device_kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as DeviceKind)}
                required
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                {KIND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                className="h-4 w-4"
              />
              {t("fields.primary")}
              <span className="text-muted-foreground">
                {t("fields.primaryHint")}
              </span>
            </label>
          </div>
          <DialogFooter className="!flex-row !justify-between">
            {current ? (
              <Button
                type="button"
                variant="ghost"
                onClick={onUnassign}
                disabled={pending}
                className="text-destructive hover:text-destructive"
              >
                {t("unassign")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
