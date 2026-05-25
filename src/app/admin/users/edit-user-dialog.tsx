"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
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
import type { Profile } from "@/lib/types";
import { updateProfile } from "./actions";
import { LOCALES, LOCALE_LABELS, isLocale } from "@/i18n/locales";

export function EditUserDialog({
  profile,
  open,
  onOpenChange,
}: {
  profile: Profile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const defaultLanguage = isLocale(profile.language) ? profile.language : "en";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateProfile({
        id: profile.id,
        full_name: String(formData.get("full_name") ?? ""),
        whatsapp: String(formData.get("whatsapp") ?? ""),
        language: String(formData.get("language") ?? ""),
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Usuario actualizado.");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Editar usuario</DialogTitle>
            <DialogDescription>{profile.email}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="full_name">Nombre completo</Label>
              <Input
                id="full_name"
                name="full_name"
                defaultValue={profile.full_name ?? ""}
                required
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="whatsapp">WhatsApp (opcional)</Label>
              <Input
                id="whatsapp"
                name="whatsapp"
                defaultValue={profile.whatsapp ?? ""}
                placeholder="+598 99 123 456"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="language">{t("lang.label")}</Label>
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
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
