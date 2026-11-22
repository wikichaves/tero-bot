import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const sections = [
  {
    key: "peoplePlaces",
    cards: [
      { key: "users", href: "/admin/users" },
      { key: "properties", href: "/admin/properties" },
    ],
  },
  {
    key: "devices",
    cards: [
      { key: "tuya", href: "/admin/tuya" },
      { key: "locks", href: "/admin/tuya/lock" },
      { key: "alarms", href: "/admin/alarms" },
    ],
  },
  {
    key: "whatsapp",
    cards: [{ key: "whatsapp", href: "/admin/whatsapp" }],
  },
] as const;

export default async function AdminPage() {
  await requireRole(["admin"]);
  const t = await getTranslations("adminPage");

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <div>
        <h1 className="text-4xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {sections.map((section) => (
        <section key={section.key} className="flex flex-col gap-3">
          <h2 className="text-2xl">{t(`sections.${section.key}`)}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.cards.map((card) => (
              <Link key={card.href} href={card.href} className="group min-w-0">
                <Card className="h-full transition-colors group-hover:border-foreground/30">
                  <CardHeader>
                    <CardTitle>{t(`cards.${card.key}.title`)}</CardTitle>
                    <CardDescription>
                      {t(`cards.${card.key}.description`)}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
