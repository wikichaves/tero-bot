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
  // WIK-201 → WIK-215 follow-up: la border-top vive en el `<footer>`
  // OUTER para que la línea cruce todo el viewport — match perfecto
  // con el header (que ya tenía la border-bottom en el outer). Antes
  // estaba en el inner div capeado a max-w-6xl, lo que hacía que el
  // footer line se viera inset 36px vs el header line que iba edge-
  // to-edge. El contenido (credits + toggles) sigue capeado al inner
  // max-w-6xl alineado con el resto.
  return (
    <footer className="border-t border-border/60 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 sm:flex-row sm:gap-4 sm:px-8">
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
