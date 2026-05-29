"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { LockPassword } from "@/lib/types";
import {
  clearAllPasswords,
  generateLockPassword,
  revokeLockPassword,
} from "./actions";

/**
 * Returns a YYYY-MM-DDTHH:00 string in local time, anchored to a full hour.
 * Tuya offline temp passwords require hour-aligned times — any precision
 * smaller than 1 hour gets rejected with "invalid offline time".
 */
function fullHourDatetimeLocal(offsetHours = 0): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + offsetHours);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type CodeRow = {
  id: string;             // tuya_password_id (used to revoke)
  name: string;
  password: string;
  effective_time: number; // unix seconds
  invalid_time: number;
};

function fromDbRow(p: LockPassword): CodeRow {
  return {
    id: p.tuya_password_id,
    name: p.name,
    password: p.password,
    effective_time: Math.floor(new Date(p.effective_time).getTime() / 1000),
    invalid_time: Math.floor(new Date(p.invalid_time).getTime() / 1000),
  };
}

export function LockCard({
  deviceId,
  deviceName,
  online,
  propertyName,
  isPrimary,
  initialPasswords,
}: {
  deviceId: string;
  deviceName: string;
  online: boolean;
  propertyName: string | null;
  isPrimary: boolean;
  initialPasswords: LockPassword[];
}) {
  const t = useTranslations("adminTuyaLockCard");
  const [pending, startTransition] = useTransition();
  const [codes, setCodes] = useState<CodeRow[]>(
    initialPasswords.map(fromDbRow),
  );

  function onGenerate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "");
    // datetime-local sends a string without timezone (e.g. "2026-05-07T00:04").
    // We convert here to a full ISO string (UTC) using the browser's local
    // timezone. Otherwise the server (Vercel runs UTC) would misinterpret
    // the user's local time as UTC, throwing off the value by hours.
    const effective_at = new Date(
      String(formData.get("effective_at") ?? ""),
    ).toISOString();
    const invalid_at = new Date(
      String(formData.get("invalid_at") ?? ""),
    ).toISOString();
    startTransition(async () => {
      const result = await generateLockPassword({
        device_id: deviceId,
        name,
        effective_at,
        invalid_at,
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if ("created" in result && result.created) {
        const c = result.created;
        toast.success(t("toast.generated", { password: c.password }));
        setCodes((curr) => [
          {
            id: c.id,
            name: c.name,
            password: c.password,
            effective_time: c.effective_time,
            invalid_time: c.invalid_time,
          },
          ...curr,
        ]);
      }
    });
  }

  function onRevoke(passwordId: string) {
    if (!confirm(t("confirm.revoke"))) return;
    startTransition(async () => {
      const result = await revokeLockPassword({
        device_id: deviceId,
        password_id: passwordId,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toast.revoked"));
      setCodes((curr) => curr.filter((c) => c.id !== passwordId));
    });
  }

  function onClearAll() {
    if (!confirm(t("confirm.clearAll", { deviceName }))) {
      return;
    }
    startTransition(async () => {
      const result = await clearAllPasswords({ device_id: deviceId });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toast.clearedAll"));
      setCodes([]);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              {deviceName}
              <Badge variant={online ? "default" : "secondary"}>
                {online ? t("badge.online") : t("badge.offline")}
              </Badge>
              {isPrimary && <Badge>{t("badge.primary")}</Badge>}
            </CardTitle>
            <CardDescription>
              {propertyName ? (
                <>{t("property.label")} <strong>{propertyName}</strong></>
              ) : (
                <>{t("property.unassigned")} <em>/admin/tuya</em></>
              )}{" "}
              ·{" "}
              <span className="font-mono text-xs">{deviceId}</span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Generate form */}
        <form onSubmit={onGenerate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`name-${deviceId}`}>{t("form.name")}</Label>
              <Input
                id={`name-${deviceId}`}
                name="name"
                required
                defaultValue="Test"
                maxLength={50}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`from-${deviceId}`}>{t("form.from")}</Label>
              <Input
                id={`from-${deviceId}`}
                name="effective_at"
                type="datetime-local"
                step={3600}
                required
                defaultValue={fullHourDatetimeLocal(0)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`to-${deviceId}`}>{t("form.to")}</Label>
              <Input
                id={`to-${deviceId}`}
                name="invalid_at"
                type="datetime-local"
                step={3600}
                required
                defaultValue={fullHourDatetimeLocal(2)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("form.hourHint")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? t("actions.generating") : t("actions.generate")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onClearAll}
              disabled={pending}
              className="text-destructive hover:text-destructive"
            >
              {t("actions.clearAll")}
            </Button>
          </div>
        </form>

        {/* Codes generated this session */}
        <div>
          <h4 className="mb-2 text-sm font-medium">{t("codes.title")}</h4>
          {codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("codes.empty")}
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {codes.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 p-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <p className="font-medium truncate">{c.name}</p>
                      <p className="font-mono tracking-wider">{c.password}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {format(
                        new Date(c.effective_time * 1000),
                        "d MMM HH:mm",
                        { locale: es },
                      )}{" "}
                      →{" "}
                      {format(
                        new Date(c.invalid_time * 1000),
                        "d MMM HH:mm",
                        { locale: es },
                      )}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRevoke(c.id)}
                    disabled={pending}
                    className="text-destructive hover:text-destructive"
                  >
                    {t("actions.revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
