"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { signIn } from "./actions";

/**
 * Form de login (WIK-113 → WIK-134): el UI solo pide teléfono.
 *
 * El server (`actions.ts`) mantiene el fallback de email como red de
 * seguridad para no romper logins legacy (cuentas sin `whatsapp`
 * configurado) — si un password manager autofill pone un email, sigue
 * funcionando. Pero el form solo muestra teléfono.
 */
export function LoginForm() {
  const [pending, startTransition] = useTransition();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await signIn({ identifier, password });
      if (result?.error) toast.error(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="identifier">Teléfono</Label>
        <Input
          id="identifier"
          // type="tel" → keypad numérico nativo en mobile. autoComplete
          // "username" sigue siendo correcto (convención password
          // managers para identificador de login, independiente de si
          // es email o phone).
          type="tel"
          autoComplete="username"
          inputMode="tel"
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="+598 99 123 456"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
