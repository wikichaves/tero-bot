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
  // con el header (que ya tenía la border-bottom en el outer).
  //
  // WIK-231: el contenido (credits + toggles) va edge-to-edge con el
  // mismo padding horizontal que el header (px-5/sm:px-8). Antes estaba
  // capeado a `mx-auto max-w-6xl`, lo que en viewports anchos centraba
  // el contenido con gutters grandes y dejaba el footer con mucho más
  // padding lateral que el header (y que el contenido de las pages, que
  // también va edge-to-edge).
  return (
    <footer className="border-t border-border/60 text-xs text-muted-foreground">
      {/* WIK-240: pb incluye env(safe-area-inset-bottom) para que el
          contenido no quede bajo el home-indicator en la PWA iOS. En
          browser el inset es 0px (fallback) → queda el py-6 normal. */}
      <div className="flex flex-col items-center justify-between gap-3 px-5 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:flex-row sm:gap-4 sm:px-8">
        {/* WIK-246: en mobile las dos frases van en líneas separadas y
            centradas (spans block). En sm+ vuelven a una sola línea con
            el separador "·" inline. */}
        <p className="text-center sm:text-left">
          <span className="block sm:inline">
            {t("createdBy")}{" "}
            <a
              href="https://wikichaves.com/"
              target="_blank"
              rel="noopener"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              Wiki Chaves
            </a>
          </span>
          <span className="hidden sm:inline">{" · "}</span>
          <span className="block sm:inline">
            <a
              href="https://github.com/wikichaves/tero-bot"
              target="_blank"
              rel="noopener"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("openSource")}
            </a>{" "}
            {t("licenseMit")}
          </span>
        </p>
        <div className="flex items-center gap-1">
          <ModeToggle />
          <LanguageSelector />
        </div>
      </div>
    </footer>
  );
}
