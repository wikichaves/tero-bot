"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { signIn } from "./actions";

/**
 * Form de login (WIK-113): acepta email O teléfono en el mismo input.
 * El server detecta cuál es según contenga "@" o solo dígitos, y si
 * es teléfono hace lookup en `profiles.whatsapp` para resolver el
 * email asociado antes de pasarle a Supabase auth.
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
        <Label htmlFor="identifier">Email o teléfono</Label>
        <Input
          id="identifier"
          // `type="text"` y no `email` — el browser rechazaría un
          // teléfono con autocomplete email. `autoComplete="username"`
          // funciona para ambos (es el convention de password
          // managers para identificador de login).
          type="text"
          autoComplete="username"
          inputMode="email"
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="tu@email.com  o  +598 99 123 456"
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
