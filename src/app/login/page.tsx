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
      {/* WIK-131: header con logo bird + APP_NAME, mirroring el
          `<SiteHeader>` del dashboard y del landing. ModeToggle ya
          vive en el footer global.
          WIK-152: matchear sticky + backdrop blur + padding del
          landing — flow visual sin saltos entre / → /login → app. */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-5 py-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 sm:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight"
        >
          <Bird className="h-5 w-5" />
          {APP_NAME}
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-5">
          <Card className="w-full gap-6 py-7">
            <CardHeader>
              <CardTitle className="text-2xl">{t("title")}</CardTitle>
              <CardDescription>{t("subtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <LoginForm />
            </CardContent>
          </Card>
          {/* WIK-269: aclarar que tero.bot es software privado (sin signup
              público) y source-available / self-hosteable. */}
          <p className="text-center text-xs text-balance text-muted-foreground">
            {t("privateNote")} {t("selfHostNote")}{" "}
            <a
              href="https://github.com/wikichaves/tero-bot"
              target="_blank"
              rel="noopener"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("viewCode")}
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
