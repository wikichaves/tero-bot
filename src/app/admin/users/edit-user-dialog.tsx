"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { Profile, Property, UserRole } from "@/lib/types";
import { ALL_ROLES, ROLE_LABEL } from "@/lib/roles";
import { updateProfile } from "./actions";
import { LOCALES, LOCALE_LABELS, isLocale } from "@/i18n/locales";

export function EditUserDialog({
  profile,
  isSelf,
  allProperties,
  scopedPropertyIds,
  open,
  onOpenChange,
}: {
  profile: Profile;
  /** WIK-248: un admin no puede cambiarse su propio rol — el select se
   *  deshabilita en ese caso (el server igual lo rechaza por las dudas). */
  isSelf: boolean;
  allProperties: Pick<Property, "id" | "name">[];
  scopedPropertyIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("usersPage");
  const locale = useLocale();
  const tLang = useTranslations("lang");
  const [pending, startTransition] = useTransition();
  const defaultLanguage = isLocale(profile.language) ? profile.language : "en";
  // WIK-242: scope editable dentro del modal (solo no-admin).
  const [selectedProps, setSelectedProps] = useState<Set<string>>(
    new Set(scopedPropertyIds),
  );
  // WIK-248: el rol se edita dentro del modal. El estado controla la
  // visibilidad del bloque de propiedades (solo aplica a no-admin).
  const [role, setRole] = useState<UserRole>(profile.role);
  const isAdmin = role === "admin";
  const contactEmail = profile.email.endsWith("@phone.tero.local") ? "" : profile.email;

  function toggleProp(id: string) {
    setSelectedProps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      // WIK-311: parseo del chat_id de Telegram. Vacío = limpiar vínculo
      // (null); texto = número (el server valida que sea entero).
      const tgRaw = String(formData.get("telegram_chat_id") ?? "").trim();
      const telegram_chat_id: number | null =
        tgRaw === "" ? null : Number(tgRaw);
      const result = await updateProfile({
        id: profile.id,
        full_name: String(formData.get("full_name") ?? ""),
        email: String(formData.get("email") ?? ""),
        whatsapp: String(formData.get("whatsapp") ?? ""),
        language: String(formData.get("language") ?? ""),
        telegram_chat_id,
        // WIK-248: si es self no mandamos role (no se puede auto-cambiar);
        // sino mandamos el rol elegido en el select.
        role: isSelf ? undefined : role,
        // admin = global, no scope; no-admin = el set elegido.
        propertyIds: isAdmin ? undefined : Array.from(selectedProps),
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toast.updated"));
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileSheet className="overflow-hidden p-0 sm:max-w-2xl sm:pb-0">
        <form onSubmit={onSubmit} className="flex min-h-0 max-h-[90dvh] flex-col">
          <DialogHeader className="shrink-0 border-b px-6 py-5 pr-12">
            <DialogTitle>{t("edit.title")}</DialogTitle>
            <DialogDescription>{contactEmail || profile.whatsapp}</DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 gap-4 overflow-y-auto px-6 py-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="full_name">{t("fields.name")}</Label>
              <Input
                id="full_name"
                name="full_name"
                defaultValue={profile.full_name ?? ""}
                required
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">{t("fields.email")}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={contactEmail}
                disabled={pending}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="whatsapp">{t("fields.phone")}</Label>
              <Input
                id="whatsapp"
                name="whatsapp"
                type="tel"
                required
                defaultValue={profile.whatsapp ?? ""}
                placeholder="+598 99 123 456"
              />
            </div>
            {/* WIK-248: cambio de rol dentro del modal (antes era un
                dropdown aparte en el row). El select controla qué se muestra
                abajo (propiedades solo para no-admin). Para self se
                deshabilita: un admin no puede quitarse su propio rol. */}
            <div className="grid gap-2">
              <Label htmlFor="role">{t("fields.role")}</Label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                disabled={isSelf}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {([...ALL_ROLES, "agency"] as UserRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              {isSelf && (
                <p className="text-xs text-muted-foreground">
                  {t("fields.roleSelfHint")}
                </p>
              )}
            </div>
            {/* WIK-242: asignación de propiedades dentro del modal (solo
                no-admin — admin tiene acceso global). */}
            {!isAdmin && (
              <div className="grid gap-2 sm:col-span-2">
                <Label>{t("fields.properties")}</Label>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {allProperties.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedProps.has(p.id)}
                        onChange={() => toggleProp(p.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span>{p.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("fields.propertiesHint")}
                </p>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="language">{tLang("label")}</Label>
              <select
                id="language"
                name="language"
                defaultValue={defaultLanguage}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                {LOCALES.map((loc) => (
                  <option key={loc} value={loc}>
                    {LOCALE_LABELS[loc]}
                  </option>
                ))}
              </select>
            </div>
            {/* WIK-311: chat_id de Telegram para el bot de operación
                (@tero_ops_bot). La persona le manda /start al bot y el bot
                le devuelve este número; el admin lo pega acá para
                autorizarla. Vacío = desvincular. */}
            <div className="grid gap-2">
              <Label htmlFor="telegram_chat_id">{t("fields.telegramChatId")}</Label>
              <Input
                id="telegram_chat_id"
                name="telegram_chat_id"
                inputMode="numeric"
                defaultValue={profile.telegram_chat_id?.toString() ?? ""}
                placeholder="8968616039"
              />
              <p className="text-xs text-muted-foreground">
                {t("fields.telegramChatIdHint")}
              </p>
            </div>
          </div>
          <DialogFooter className="m-0 shrink-0 items-center">
            <p className="mr-auto text-xs text-muted-foreground">{t("edit.created", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(profile.created_at)) })}</p>
            <Button type="submit" disabled={pending}>
              {pending ? t("edit.submitting") : t("edit.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
