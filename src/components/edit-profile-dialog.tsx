"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Profile } from "@/lib/types";
import { updateOwnProfile } from "@/app/account/actions";
import {
  LOCALES,
  LOCALE_LABELS,
  isLocale,
  type Locale,
} from "@/i18n/locales";

/**
 * Dialog para que cualquier user edite su propio perfil (WIK-112).
 * Permite cambiar `full_name` y `whatsapp`. Email y role son admin-only
 * (gestionados en /admin/users).
 */
export function EditProfileDialog({
  profile,
  open,
  onOpenChange,
}: {
  profile: Profile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [whatsapp, setWhatsapp] = useState(profile.whatsapp ?? "");
  const [language, setLanguage] = useState<Locale>(
    isLocale(profile.language) ? profile.language : "en",
  );
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const r = await updateOwnProfile({
        full_name: fullName,
        whatsapp,
        language,
      });
      if (r?.error) {
        toast.error(r.error);
        return;
      }
      toast.success("Perfil actualizado.");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mi perfil</DialogTitle>
          <DialogDescription>
            Tu email y rol los gestiona un admin. Acá podés editar nombre
            y teléfono.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="email" className="text-sm">
              Email
            </Label>
            <Input
              id="email"
              value={profile.email}
              disabled
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="full_name" className="text-sm">
              Nombre
            </Label>
            <Input
              id="full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Wiki Chaves"
              className="mt-1"
              required
            />
          </div>
          <div>
            <Label htmlFor="whatsapp" className="text-sm">
              Teléfono (WhatsApp)
            </Label>
            <Input
              id="whatsapp"
              type="tel"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+598 99 123 456"
              className="mt-1"
              autoComplete="tel"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Usado para recibir mensajes del bot y para login con
              teléfono.
            </p>
          </div>
          <div>
            <Label htmlFor="language" className="text-sm">
              {t("lang.label")}
            </Label>
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as Locale)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              {LOCALES.map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_LABELS[loc]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !fullName.trim()}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
