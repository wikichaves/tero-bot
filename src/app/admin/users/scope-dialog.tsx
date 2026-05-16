"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Profile, Property } from "@/lib/types";
import { setProfileProperties } from "./actions";

/**
 * Dialog para asignar properties (scope) a un profile (WIK-94).
 *
 * Solo aplica a gestor / mantenimiento. Admin tiene acceso global y no
 * necesita scope.
 *
 * UI: lista de checkboxes con todas las properties. El admin marca las
 * que el profile puede ver/manejar. Se persisten reemplazando el set
 * completo (no incremental).
 *
 * Controlled mode (open/onOpenChange) para que el caller (UserActions)
 * abra el dialog desde un dropdown menu item sin issues de Base UI
 * (mismo patrón que WIK-91 alarm-rule-row).
 */
export function ScopeDialog({
  profile,
  allProperties,
  initialPropertyIds,
  open,
  onOpenChange,
}: {
  profile: Pick<Profile, "id" | "full_name" | "email" | "role">;
  allProperties: Pick<Property, "id" | "name">[];
  initialPropertyIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialPropertyIds),
  );
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await setProfileProperties({
        profileId: profile.id,
        propertyIds: Array.from(selected),
      });
      if (r?.error) {
        toast.error(r.error);
        return;
      }
      toast.success("Properties actualizadas.");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Properties asignadas</DialogTitle>
            <DialogDescription>
              {profile.full_name ?? profile.email} (
              {profile.role}). Marcá las propiedades que este usuario
              puede ver y manejar.
              {profile.role === "admin" && (
                <span className="mt-1 block text-amber-600">
                  Admin tiene acceso global a TODAS las properties — el
                  scope no aplica.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            {allProperties.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                  className="h-4 w-4 accent-primary"
                />
                <span>{p.name}</span>
              </label>
            ))}
            {allProperties.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No hay properties cargadas.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
