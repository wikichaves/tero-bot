"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "./actions";

export function ResetPasswordForm() {
  const t = useTranslations("login.recovery");
  const token = useRef("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (value) token.current = value;
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) { setError("mismatch"); return; }
    startTransition(async () => {
      try {
        const result = await resetPassword({ token: token.current, password });
        if (result.error) { setError(result.error); return; }
        token.current = "";
        setPassword(""); setConfirmation(""); setDone(true);
      } catch { setError("failed"); }
    });
  }
  return <section className="w-full max-w-sm space-y-5">
    <h1 className="text-2xl font-semibold">{t("resetTitle")}</h1>
    {done ? <p role="status">{t("success")}</p> : <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("passwordHint")}</p>
      <div className="space-y-2"><Label htmlFor="new-password">{t("newPassword")}</Label>
        <Input id="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="confirm-password">{t("confirmPassword")}</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></div>
      {error && <p role="alert" className="text-sm text-status-critical">{t(error)}</p>}
      <Button type="submit" disabled={pending} className="w-full">{t(pending ? "saving" : "save")}</Button>
      {error && <Link className="block text-sm underline" href="/login/recover">{t("requestAnother")}</Link>}
    </form>}
    <Link className="block text-sm underline" href="/login">{t("back")}</Link>
  </section>;
}
