"use client";

import { useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { Profile, UserRole } from "@/lib/types";
import { deleteUser, updateRole } from "./actions";

const ROLES: UserRole[] = ["admin", "gestor", "limpieza", "mantenimiento"];

export function UserActions({
  profile,
  isSelf,
}: {
  profile: Profile;
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function changeRole(role: UserRole) {
    startTransition(async () => {
      const r = await updateRole({ id: profile.id, role });
      if (r?.error) toast.error(r.error);
      else toast.success("Rol actualizado.");
    });
  }

  function remove() {
    if (!confirm(`¿Eliminar a ${profile.email}? No se puede deshacer.`)) return;
    startTransition(async () => {
      const r = await deleteUser(profile.id);
      if (r?.error) toast.error(r.error);
      else toast.success("Usuario eliminado.");
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" disabled={pending} />}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Cambiar rol</DropdownMenuLabel>
        {ROLES.filter((r) => r !== profile.role).map((r) => (
          <DropdownMenuItem key={r} onClick={() => changeRole(r)}>
            {r}
          </DropdownMenuItem>
        ))}
        {!isSelf && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={remove}
              className="text-destructive focus:text-destructive"
            >
              Eliminar
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
