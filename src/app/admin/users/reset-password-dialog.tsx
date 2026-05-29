"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
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
import { resetUserPassword } from "./actions";

/**
 * Dialog para que un admin resetee el password de cualquier usuario
 * (WIK-106). Caso típico: el staff se olvidó su password y lo pide
 * por chat al admin.
 *
 * Generar password random con click — el admin lo lee/copia y se lo
 * manda al user. Toggle de visibilidad para confirmar antes de guardar.
 */
export function ResetPasswordDialog({
  userId,
  userEmail,
  open,
  onOpenChange,
}: {
  userId: string;
  userEmail: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("adminResetPassword");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, startTransition] = useTransition();

  function generateRandom() {
    // 12 chars alfanuméricos + algunos símbolos friendly de tipear.
    // Excluimos caracteres confusos (0/O, 1/l) para evitar errores al
    // dictar el password por WhatsApp.
    const chars =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    let pwd = "";
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    for (const n of arr) {
      pwd += chars[n % chars.length];
    }
    setPassword(pwd);
    setShowPassword(true);
  }

  function submit() {
    if (password.length < 8) {
      toast.error(t("toast.minLength"));
      return;
    }
    startTransition(async () => {
      const r = await resetUserPassword({ id: userId, password });
      if (r?.error) {
        toast.error(r.error);
        return;
      }
      toast.success(t("toast.success"));
      setPassword("");
      setShowPassword(false);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t.rich("description", {
              email: userEmail,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="new-password" className="text-sm">
              {t("fields.newPassword")}
            </Label>
            <div className="mt-1 flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("fields.placeholder")}
                  className="font-mono"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? t("toggle.hide") : t("toggle.show")}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={generateRandom}
                disabled={pending}
              >
                {t("generate")}
              </Button>
            </div>
          </div>
          {showPassword && password && (
            <p className="text-xs text-muted-foreground">
              {t("copyTip")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={pending || password.length < 8}
          >
            {pending ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
