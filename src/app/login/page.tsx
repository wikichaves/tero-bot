import Link from "next/link";
import { Bird } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { APP_NAME } from "@/lib/brand";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const t = await getTranslations("login");
  return (
    <div className="flex flex-1 flex-col">
      {/* WIK-131: header con logo bird + APP_NAME, mirroring the
          logged-in `<SiteHeader>` layout. ModeToggle ya vive en el
          footer del landing, no se repite acá. */}
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight"
        >
          <Bird className="h-5 w-5" />
          {APP_NAME}
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-sm gap-6 py-7">
          <CardHeader>
            <CardTitle className="text-2xl">{t("title")}</CardTitle>
            <CardDescription>{t("subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
