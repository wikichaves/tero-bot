"use client";

import { useState, useTransition } from "react";
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
import {
  clearAllPasswords,
  generateLockPassword,
  revokeLockPassword,
} from "./actions";

function nowDatetimeLocal(offsetMinutes = 0): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type SessionCode = {
  id: string;
  name: string;
  password: string;
  effective_time: number;
  invalid_time: number;
};

export function LockCard({
  deviceId,
  deviceName,
  online,
  propertyName,
  isPrimary,
}: {
  deviceId: string;
  deviceName: string;
  online: boolean;
  propertyName: string | null;
  isPrimary: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [codes, setCodes] = useState<SessionCode[]>([]);

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
      setCodes((curr) => curr.filter((c) => c.id !== passwordId));
    });
  }

  function onClearAll() {
    if (
      !confirm(
        `¿Borrar TODOS los códigos temporales de "${deviceName}"? Esto incluye códigos creados desde la app Smart Life o desde sesiones anteriores. No se puede deshacer.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await clearAllPasswords({ device_id: deviceId });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Todos los códigos fueron borrados.");
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
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Generando…" : "Generar código"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onClearAll}
              disabled={pending}
              className="text-destructive hover:text-destructive"
            >
              Borrar todos los códigos del lock
            </Button>
          </div>
        </form>

        {/* Codes generated this session */}
        <div>
          <h4 className="mb-2 text-sm font-medium">
            Códigos generados en esta sesión
          </h4>
          {codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin códigos generados todavía. Tuya no expone una API para listar
              los activos — los seguimos en la próxima iteración persistiéndolos
              en la DB cuando los creamos.
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
