"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
import { LOCALES, LOCALE_LABELS } from "@/i18n/locales";
import type { Property } from "@/lib/types";

export function NewUserDialog({
  allProperties,
}: {
  allProperties: Pick<Property, "id" | "name">[];
}) {
  const t = useTranslations("usersPage");
  const tLang = useTranslations("lang");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // WIK-242: el role se trackea en estado para mostrar/ocultar el
  // multi-select de propiedades (solo aplica a no-admin).
  const [role, setRole] = useState("gestor");
  const [selectedProps, setSelectedProps] = useState<Set<string>>(new Set());

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
    const form = e.currentTarget;
    const formData = new FormData(form);
    // WIK-242: las propiedades asignadas viajan como entries repetidas
    // `property_ids`. Solo para no-admin (admin = acceso global).
    if (role !== "admin") {
      for (const id of selectedProps) formData.append("property_ids", id);
    }
    startTransition(async () => {
      const result = await createUser(formData);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toast.created"));
      form.reset();
      setRole("gestor");
      setSelectedProps(new Set());
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>{t("newUser")}</DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{t("create.title")}</DialogTitle>
            <DialogDescription>{t("create.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* WIK-242: orden — Nombre, Teléfono (2do), Email, Password, Rol. */}
            <div className="grid gap-2">
              <Label htmlFor="full_name">{t("fields.name")}</Label>
              <Input id="full_name" name="full_name" required autoFocus />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="whatsapp">{t("fields.phone")}</Label>
              <Input
                id="whatsapp"
                name="whatsapp"
                type="tel"
                required
                placeholder="+598 99 123 456"
              />
              <p className="text-xs text-muted-foreground">
                {t("fields.phoneHintCreate")}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">{t("fields.email")}</Label>
              <Input id="email" name="email" type="email" />
              <p className="text-xs text-muted-foreground">
                {t("fields.emailHint")}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{t("fields.password")}</Label>
              <Input
                id="password"
                name="password"
                type="text"
                minLength={8}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">{t("fields.role")}</Label>
              <select
                id="role"
                name="role"
                required
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                {/* WIK-241: `mantenimiento` se muestra como "Staff". */}
                <option value="admin">Admin</option>
                <option value="gestor">Gestor</option>
                <option value="mantenimiento">Staff</option>
              </select>
            </div>
            {/* WIK-242: asignación de propiedades dentro del modal (antes era
                un dialog aparte). Solo para no-admin — admin = global. */}
            {role !== "admin" && (
              <div className="grid gap-2">
                <Label>{t("fields.properties")}</Label>
                <div className="grid gap-1.5">
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
                defaultValue="es"
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
              {pending ? t("create.submitting") : t("create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
