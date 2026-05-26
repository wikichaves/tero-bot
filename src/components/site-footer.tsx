import { getTranslations } from "next-intl/server";
import { ModeToggle } from "@/components/mode-toggle";
import { LanguageSelector } from "@/components/language-selector";

/**
 * Footer global (WIK-151) — usado tanto en la landing como en el
 * dashboard logged-in.
 *
 * Estructura: credits a la izquierda, toggles (theme + language) a la
 * derecha. Reuso del look minimal del landing footer pre-WIK-151;
 * la novedad es el language selector.
 *
 * Server component porque las strings vienen de next-intl. Los
 * toggles dentro son client.
 */
export async function SiteFooter() {
  const t = await getTranslations("footer");
  // WIK-201 follow-up: el footer outer queda full-width (sin styling
  // visible), y el inner row se capea a `max-w-6xl` para alinear con
  // el resto del contenido (modules grid, atmosphere photo). En
  // resoluciones grandes la línea horizontal del border y el contenido
  // ahora respetan el mismo ancho que las secciones.
  return (
    <footer className="text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-border/60 px-5 py-6 sm:flex-row sm:gap-4 sm:px-8">
        <p className="text-center sm:text-left">
          {t("createdBy")}{" "}
          <a
            href="https://wikichaves.com/"
            target="_blank"
            rel="noopener"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            Wiki Chaves
          </a>
          {" · "}
          <a
            href="https://github.com/wikichaves/tero-bot"
            target="_blank"
            rel="noopener"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("openSource")}
          </a>{" "}
          {t("licenseMit")}
        </p>
        <div className="flex items-center gap-1">
          <ModeToggle />
          <LanguageSelector />
        </div>
      </div>
    </footer>
  );
}
