"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setLanguageAction } from "@/app/actions/set-language";
import {
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT,
  type Locale,
} from "@/i18n/locales";

/**
 * Selector de idioma (WIK-151). Mismo patrón visual que el ModeToggle:
 * un icon-button que abre dropdown con las opciones.
 *
 * El trigger muestra el code corto del locale actual (EN/ES) para que
 * sea legible sin abrir el menú — al lado del ModeToggle queda más
 * útil que solo un icono genérico de globo.
 *
 * Al seleccionar un locale, llama al server action que dual-writes
 * cookie + profile.language, y revalida `/` para que el render use
 * el nuevo idioma.
 */
export function LanguageSelector() {
  const currentLocale = useLocale() as Locale;
  const [pending, startTransition] = useTransition();

  const onSelect = (locale: Locale) => {
    if (locale === currentLocale) return;
    startTransition(async () => {
      await setLanguageAction(locale);
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label="Language"
            className="gap-1.5 px-2"
          />
        }
      >
        <Languages className="h-4 w-4" />
        <span className="font-mono text-xs uppercase tracking-wider">
          {LOCALE_SHORT[currentLocale]}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((loc) => (
          <DropdownMenuItem
            key={loc}
            onClick={() => onSelect(loc)}
            data-active={loc === currentLocale}
            // WIK-191: el locale activo además de font-semibold pinta
            // en deep-accent — refuerza visualmente "selected" con el
            // mismo token que el ring / Sign in / FilterPill activo.
            className="data-[active=true]:font-semibold data-[active=true]:text-deep-accent"
          >
            <span className="font-mono text-xs uppercase tracking-wider mr-2 opacity-70">
              {LOCALE_SHORT[loc]}
            </span>
            {LOCALE_LABELS[loc]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
