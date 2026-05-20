"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { Profile, Property, UserRole } from "@/lib/types";
import { ALL_ROLES, ROLE_LABEL } from "@/lib/roles";
import { deleteUser, updateRole } from "./actions";
import { EditUserDialog } from "./edit-user-dialog";
import { ScopeDialog } from "./scope-dialog";
import { ResetPasswordDialog } from "./reset-password-dialog";

export function UserActions({
  profile,
  isSelf,
  allProperties,
  scopedPropertyIds,
}: {
  profile: Profile;
  isSelf: boolean;
  /** Lista completa de properties (para el scope dialog). */
  allProperties: Pick<Property, "id" | "name">[];
  /** IDs de las properties actualmente asignadas al profile. Empty array
   *  si gestor/mantenimiento sin scope, o si es admin (admin no usa
   *  scope — tiene acceso global). */
  scopedPropertyIds: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [resetPwdOpen, setResetPwdOpen] = useState(false);

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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" disabled={pending} />}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Editar
          </DropdownMenuItem>
          {/* Scope solo aplica a gestor/mantenimiento. Admin tiene acceso
              global. (WIK-94) */}
          {profile.role !== "admin" && (
            <DropdownMenuItem onClick={() => setScopeOpen(true)}>
              Asignar propiedades
            </DropdownMenuItem>
          )}
          {/* WIK-106: reset password de cualquier user. */}
          <DropdownMenuItem onClick={() => setResetPwdOpen(true)}>
            Resetear password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Cambiar rol</DropdownMenuLabel>
            {ALL_ROLES.filter((r) => r !== profile.role).map((r) => (
              <DropdownMenuItem key={r} onClick={() => changeRole(r)}>
                {ROLE_LABEL[r]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
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
      <EditUserDialog
        profile={profile}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      {/* Conditional mount — solo cuando scope dialog está abierto, igual
          patrón que WIK-91 (alarm-rule-row). */}
      {scopeOpen && (
        <ScopeDialog
          profile={profile}
          allProperties={allProperties}
          initialPropertyIds={scopedPropertyIds}
          open={scopeOpen}
          onOpenChange={setScopeOpen}
        />
      )}
      {resetPwdOpen && (
        <ResetPasswordDialog
          userId={profile.id}
          userEmail={profile.email}
          open={resetPwdOpen}
          onOpenChange={setResetPwdOpen}
        />
      )}
    </>
  );
}
