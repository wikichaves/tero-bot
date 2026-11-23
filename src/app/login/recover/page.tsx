import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

export default async function RecoverPasswordPage() {
  const t = await getTranslations("login.recovery");
  const phone = process.env.WHATSAPP_RECOVERY_PHONE?.replace(/\D/g, "") || "59842772169";
  const url = `https://wa.me/${phone}?text=${encodeURIComponent("recuperar contraseña")}`;
  return <main className="flex flex-1 items-center justify-center p-6">
    <section className="w-full max-w-sm space-y-5">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("instructions")}</p>
      <Button className="w-full" render={<a href={url} target="_blank" rel="noopener noreferrer" />}>{t("openWhatsApp")}</Button>
      <p className="text-sm text-muted-foreground">{t("noAccess")}</p>
      <Link href="/login" className="block text-sm underline">{t("back")}</Link>
    </section>
  </main>;
}
