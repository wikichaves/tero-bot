import { requireRole } from "@/lib/auth";
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-4xl">WhatsApp Templates</h1>
          <p className="text-sm text-muted-foreground">
            {allTemplates.length} templates registradas. Submit a Kapso/Meta
            para aprobación — toma 1-2 días por template.
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
                      Body provisto por Meta (AUTHENTICATION)
                      {c.add_security_recommendation
                        ? " · con security recommendation"
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
                        Footer: {c.text}
                      </p>
                    );
                  }
                  return (
                    <p
                      key={idx}
                      className="mt-2 text-xs italic text-muted-foreground"
                    >
                      Footer: código expira en {c.code_expiration_minutes} min
                    </p>
                  );
                }
                if (c.type === "BUTTONS") {
                  return (
                    <p
                      key={idx}
                      className="mt-2 text-xs italic text-muted-foreground"
                    >
                      Botones:{" "}
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
          <CardTitle className="text-base">Notas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Las templates se referencian por <code>name</code> al enviarlas
            con <code>sendKapsoTemplate(name, language, variables)</code>. Las
            variables <code>{"{{N}}"}</code> en el body se llenan al enviar.
          </p>
          <p>
            Meta rechaza submits duplicados con el mismo <code>name</code>.
            Si ya fue submitted, el botón de abajo te muestra el error y
            podés ignorar — la template sigue en revisión / aprobada.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
