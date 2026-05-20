"use client";

import { useState } from "react";
import Link from "next/link";
import { User as UserIcon, ChevronDown, LogOut, Pencil } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Profile } from "@/lib/types";
import { EditProfileDialog } from "./edit-profile-dialog";

/**
 * User dropdown del header (WIK-112). Reemplaza el span con email
 * suelto + botón "Salir" por un agrupamiento con:
 *   - Trigger: nombre del user (o email si no tiene nombre) + chevron
 *   - Items: email · phone · botón Editar · botón Salir
 *
 * El display name es `full_name` con fallback al primer segmento del
 * email para que el header siempre tenga algo legible.
 */
export function UserDropdown({ profile }: { profile: Profile }) {
  const [editOpen, setEditOpen] = useState(false);

  const displayName =
    profile.full_name?.trim() ||
    profile.email.split("@")[0] ||
    "Usuario";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
            />
          }
        >
          <UserIcon className="h-4 w-4" />
          <span className="hidden sm:inline">{displayName}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{displayName}</p>
            <p className="text-xs text-muted-foreground break-all">
              {profile.email}
            </p>
            {profile.whatsapp && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {profile.whatsapp}
              </p>
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            render={
              <form action={signOut} className="w-full">
                <button
                  type="submit"
                  className="flex w-full items-center text-left"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Salir
                </button>
              </form>
            }
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {editOpen && (
        <EditProfileDialog
          profile={profile}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </>
  );
}
