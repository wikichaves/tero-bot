import { requireRole } from "@/lib/auth";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { allTemplates } from "@/lib/whatsapp/templates";
import { SubmitTemplatesButton } from "./submit-templates-button";

/**
 * /admin/whatsapp — gestión de templates de WhatsApp (WIK-78).
 *
 * Muestra las 5 templates registradas en `lib/whatsapp/templates.ts`
 * con un botón para submitarlas a Kapso/Meta. Meta aprueba en 1-2 días.
 *
 * Es una pantalla "operacional one-shot" — no se usa todos los días.
 * Funcionalidad mínima: ver las templates + disparar el submit + ver
 * el resultado. El status real (PENDING/APPROVED/REJECTED) de cada
 * template hay que consultarlo después en Kapso dashboard o con
 * `npm run wa:templates:status`.
 */

export const dynamic = "force-dynamic";

const CATEGORY_VARIANT: Record<
  "MARKETING" | "UTILITY" | "AUTHENTICATION",
  "default" | "secondary" | "outline"
> = {
  MARKETING: "outline",
  UTILITY: "default",
  AUTHENTICATION: "secondary",
};

export default async function WhatsAppAdminPage() {
  await requireRole(["admin"]);
  const tr = await getTranslations("adminWhatsappPage");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-4xl">{tr("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {tr("subtitle", { count: allTemplates.length })}
          </p>
        </div>
        <SubmitTemplatesButton />
      </div>

      <div className="flex flex-col gap-3">
        {allTemplates.map((t) => (
          <Card key={`${t.name}__${t.language}`}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <CardTitle className="font-mono text-sm">{t.name}</CardTitle>
                <div className="flex gap-1.5">
                  <Badge variant={CATEGORY_VARIANT[t.category]} className="text-[10px]">
                    {t.category}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {t.language}
                  </Badge>
                </div>
              </div>
              <CardDescription>{t.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {t.components.map((c, idx) => {
                if (c.type === "BODY") {
                  // AUTHENTICATION BODY no tiene `text` — Meta lo provee.
                  if ("text" in c) {
                    return (
                      <pre
                        key={idx}
                        className="overflow-x-auto whitespace-pre-wrap rounded border bg-muted/40 p-2 text-xs"
                      >
                        {c.text}
                      </pre>
                    );
                  }
                  return (
                    <p
                      key={idx}
                      className="rounded border bg-muted/40 p-2 text-xs italic text-muted-foreground"
                    >
                      {tr("bodyProvidedByMeta")}
                      {c.add_security_recommendation
                        ? tr("withSecurityRecommendation")
                        : ""}
                    </p>
                  );
                }
                if (c.type === "FOOTER") {
                  if ("text" in c) {
                    return (
                      <p
                        key={idx}
                        className="mt-2 text-xs italic text-muted-foreground"
                      >
                        {tr("footerWithText", { text: c.text })}
                      </p>
                    );
                  }
                  return (
                    <p
                      key={idx}
                      className="mt-2 text-xs italic text-muted-foreground"
                    >
                      {tr("footerCodeExpires", {
                        minutes: c.code_expiration_minutes,
                      })}
                    </p>
                  );
                }
                if (c.type === "BUTTONS") {
                  return (
                    <p
                      key={idx}
                      className="mt-2 text-xs italic text-muted-foreground"
                    >
                      {tr("buttons")}{" "}
                      {c.buttons
                        .map((b) =>
                          "text" in b ? b.text : "?",
                        )
                        .join(" · ")}
                    </p>
                  );
                }
                return null;
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tr("notesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            {tr.rich("notesReference", {
              name: () => <code>name</code>,
              fn: () => <code>sendKapsoTemplate(name, language, variables)</code>,
              vars: () => <code>{"{{N}}"}</code>,
            })}
          </p>
          <p>
            {tr.rich("notesDuplicate", {
              name: () => <code>name</code>,
            })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
