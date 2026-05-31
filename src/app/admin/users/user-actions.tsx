"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { Profile, Property } from "@/lib/types";
import { deleteUser, sendStaffWelcome } from "./actions";
import { EditUserDialog } from "./edit-user-dialog";
import { ResetPasswordDialog } from "./reset-password-dialog";

export function UserActions({
  profile,
  isSelf,
  allProperties,
  scopedPropertyIds,
  botWhatsappNumber,
}: {
  profile: Profile;
  isSelf: boolean;
  /** Lista completa de properties (para el scope dialog). */
  allProperties: Pick<Property, "id" | "name">[];
  /** IDs de las properties actualmente asignadas al profile. Empty array
   *  si gestor/mantenimiento sin scope, o si es admin (admin no usa
   *  scope — tiene acceso global). */
  scopedPropertyIds: string[];
  /** Número del bot (E.164 sin "+") para el link de activación wa.me.
   *  null si WHATSAPP_DISPLAY_NUMBER no está configurado. */
  botWhatsappNumber: string | null;
}) {
  const t = useTranslations("usersPage");
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [resetPwdOpen, setResetPwdOpen] = useState(false);

  function remove() {
    const who = profile.full_name ?? profile.email;
    if (!confirm(t("confirmDelete", { who }))) return;
    startTransition(async () => {
      const r = await deleteUser(profile.id);
      if (r?.error) toast.error(r.error);
      else toast.success(t("toast.deleted"));
    });
  }

  // WIK-278: link click-to-chat para que el operador abra la ventana de 24h.
  // Al tocarlo, manda "Activar mi acceso" al bot → el webhook responde con la
  // bienvenida como mensaje de sesión (entrega confiable).
  async function copyActivationLink() {
    if (!botWhatsappNumber) return;
    const link = `https://wa.me/${botWhatsappNumber}?text=${encodeURIComponent(
      "Activar mi acceso",
    )}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("toast.activationLinkCopied"), { description: link });
    } catch {
      // Clipboard puede fallar (permisos / contexto no seguro) — mostramos el
      // link en el toast para copiarlo a mano.
      toast.info(link);
    }
  }

  function sendWelcome() {
    if (
      !confirm(
        t("confirmWelcome", { who: profile.full_name ?? profile.email }),
      )
    )
      return;
    startTransition(async () => {
      const r = await sendStaffWelcome(profile.id);
      if ("error" in r) {
        // Error real de envío — Meta/Kapso rechazó la request. Duración
        // larga + el detalle exacto para poder diagnosticar sin adivinar.
        toast.error("No se pudo enviar la bienvenida", {
          description: r.error,
          duration: 12000,
        });
        return;
      }
      // OJO: messageId = Meta ACEPTÓ la request, NO que se entregó al
      // teléfono. La entrega es asíncrona y depende de Meta (categoría
      // del template, opt-in del número, etc.). Por eso el toast lo
      // aclara — así sabés si "no llegó" es problema de envío (no hay id)
      // o de entrega (hay id pero no aparece en el chat).
      const tmpl =
        r.templateUsed === "staff_welcome_v3"
          ? "v3 (acceso activado)"
          : "v1 genérico (v3 pendiente de aprobación de Meta)";
      if (r.messageId) {
        toast.success("Meta aceptó la bienvenida ✓", {
          description: `Template ${tmpl} · id ${r.messageId.slice(0, 22)}…\nSi no aparece en el chat en 1-2 min, es un tema de entrega de Meta (no de envío).`,
          duration: 12000,
        });
      } else {
        toast.warning("Enviada pero Meta no devolvió ID", {
          description: `Template ${tmpl}. Sin messageId no se puede confirmar que Meta la aceptó — revisá en Kapso.`,
          duration: 12000,
        });
      }
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
            {t("menu.edit")}
          </DropdownMenuItem>
          {/* WIK-242: "Asignar propiedades" se movió DENTRO del modal de
              edición (no más dialog aparte). El scope se edita ahí. */}
          {/* WIK-106: reset password de cualquier user. */}
          <DropdownMenuItem onClick={() => setResetPwdOpen(true)}>
            {t("menu.resetPassword")}
          </DropdownMenuItem>
          {/* WIK-177: mandar template `staff_welcome` para abrir la ventana
              de 24h y que el gestor/mantenimiento pueda escribir libre
              después. No tiene sentido para admin (que generalmente ya
              configuró el sistema) — lo escondemos. */}
          {profile.whatsapp && profile.role !== "admin" && (
            <DropdownMenuItem onClick={sendWelcome}>
              {t("menu.sendWelcome")}
            </DropdownMenuItem>
          )}
          {/* WIK-278: link de activación (abre ventana de 24h → bienvenida
              como mensaje de sesión, entrega confiable). */}
          {botWhatsappNumber && profile.whatsapp && profile.role !== "admin" && (
            <DropdownMenuItem onClick={copyActivationLink}>
              {t("menu.copyActivationLink")}
            </DropdownMenuItem>
          )}
          {/* WIK-248: el cambio de rol se movió al modal de edición (campo
              "Rol") — antes era este grupo de items en el dropdown. */}
          {!isSelf && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={remove}
                className="text-destructive focus:text-destructive"
              >
                {t("menu.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <EditUserDialog
        profile={profile}
        isSelf={isSelf}
        allProperties={allProperties}
        scopedPropertyIds={scopedPropertyIds}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
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
