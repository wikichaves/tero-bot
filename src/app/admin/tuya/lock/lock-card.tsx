"use client";

import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
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
import type { LockTempPassword } from "@/lib/tuya/lock";
import { generateLockPassword, revokeLockPassword } from "./actions";

function nowDatetimeLocal(offsetMinutes = 0): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  // Convert to a YYYY-MM-DDTHH:mm string in local time for <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type ActiveCode = LockTempPassword & {
  // populated locally when we just generated a code
  password?: string;
};

export function LockCard({
  deviceId,
  deviceName,
  online,
  propertyName,
  isPrimary,
  initialPasswords,
  listError,
}: {
  deviceId: string;
  deviceName: string;
  online: boolean;
  propertyName: string | null;
  isPrimary: boolean;
  initialPasswords: LockTempPassword[];
  listError: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [passwords, setPasswords] =
    useState<ActiveCode[]>(initialPasswords);
  const [lastGenerated, setLastGenerated] = useState<{
    name: string;
    password: string;
    invalid_time: number;
  } | null>(null);

  function onGenerate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "");
    const effective_at = String(formData.get("effective_at") ?? "");
    const invalid_at = String(formData.get("invalid_at") ?? "");
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
        toast.success(`Código generado: ${c.password}`);
        setLastGenerated({
          name,
          password: c.password,
          invalid_time: c.invalid_time,
        });
        setPasswords((curr) => [
          {
            id: c.id,
            name,
            effective_time: c.effective_time,
            invalid_time: c.invalid_time,
            password: c.password,
          },
          ...curr,
        ]);
      }
    });
  }

  function onRevoke(passwordId: string) {
    if (!confirm("¿Revocar este código?")) return;
    startTransition(async () => {
      const result = await revokeLockPassword({
        device_id: deviceId,
        password_id: passwordId,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Código revocado.");
      setPasswords((curr) => curr.filter((p) => p.id !== passwordId));
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
                {online ? "online" : "offline"}
              </Badge>
              {isPrimary && <Badge>primaria</Badge>}
            </CardTitle>
            <CardDescription>
              {propertyName ? (
                <>Propiedad: <strong>{propertyName}</strong></>
              ) : (
                <>Sin propiedad asignada — asignala desde <em>/admin/tuya</em></>
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
              <Label htmlFor={`name-${deviceId}`}>Nombre</Label>
              <Input
                id={`name-${deviceId}`}
                name="name"
                required
                defaultValue="Test"
                maxLength={50}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`from-${deviceId}`}>Desde</Label>
              <Input
                id={`from-${deviceId}`}
                name="effective_at"
                type="datetime-local"
                required
                defaultValue={nowDatetimeLocal(1)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`to-${deviceId}`}>Hasta</Label>
              <Input
                id={`to-${deviceId}`}
                name="invalid_at"
                type="datetime-local"
                required
                defaultValue={nowDatetimeLocal(60)}
              />
            </div>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Generando…" : "Generar código"}
          </Button>
        </form>

        {/* Last generated code (show prominently) */}
        {lastGenerated && (
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="text-xs text-muted-foreground">
              Último código generado para{" "}
              <strong>{lastGenerated.name}</strong>, válido hasta{" "}
              {format(
                new Date(lastGenerated.invalid_time * 1000),
                "EEE d MMM HH:mm",
                { locale: es },
              )}
              :
            </p>
            <p className="mt-1 font-mono text-3xl tracking-widest">
              {lastGenerated.password}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Anotalo ahora — Tuya no nos lo devuelve más después.
            </p>
          </div>
        )}

        {/* Active codes list */}
        <div>
          <h4 className="mb-2 text-sm font-medium">Códigos activos</h4>
          {listError ? (
            <p className="text-sm text-muted-foreground">
              No pude leer la lista de códigos ({listError}). El generar/revocar
              igual debería funcionar.
            </p>
          ) : passwords.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin códigos activos en esta cerradura.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {passwords.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(
                        new Date(p.effective_time * 1000),
                        "d MMM HH:mm",
                        { locale: es },
                      )}{" "}
                      →{" "}
                      {format(
                        new Date(p.invalid_time * 1000),
                        "d MMM HH:mm",
                        { locale: es },
                      )}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRevoke(p.id)}
                    disabled={pending}
                    className="text-destructive hover:text-destructive"
                  >
                    Revocar
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
