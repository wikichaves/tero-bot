"use client";

import { useState, useTransition } from "react";
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
import { toast } from "sonner";
import { createUser } from "./actions";

export function NewUserDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await createUser(formData);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Usuario creado.");
      form.reset();
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>Nuevo usuario</DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Crear usuario</DialogTitle>
            <DialogDescription>
              El usuario va a poder ingresar inmediatamente con el email y la
              contraseña que pongas acá.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="full_name">Nombre completo</Label>
              <Input id="full_name" name="full_name" required autoFocus />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email (opcional)</Label>
              <Input id="email" name="email" type="email" />
              <p className="text-xs text-muted-foreground">
                Si no lo cargás, el user solo va a poder loguearse con
                teléfono.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Contraseña inicial</Label>
              <Input
                id="password"
                name="password"
                type="text"
                minLength={8}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">Rol</Label>
              <select
                id="role"
                name="role"
                required
                defaultValue="gestor"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                <option value="admin">Admin</option>
                <option value="gestor">Gestor</option>
                <option value="mantenimiento">Mantenimiento</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="whatsapp">Teléfono (WhatsApp)</Label>
              <Input
                id="whatsapp"
                name="whatsapp"
                type="tel"
                required
                placeholder="+598 99 123 456"
              />
              <p className="text-xs text-muted-foreground">
                Obligatorio. Usado para login y para mensajes del bot.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
