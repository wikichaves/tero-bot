import { format } from "date-fns";
import { enUS, es } from "date-fns/locale";

/**
 * Helpers para formatear fechas según el locale activo (WIK-151).
 *
 * date-fns no es locale-aware por defecto — hay que pasarle el `locale`
 * de la lib + la format string apropiada. Estos helpers encapsulan
 * eso para que las pages no tengan ifs por todos lados.
 *
 * Si en algún momento se suma un tercer idioma, agregás un `case`
 * acá (importás el locale de date-fns/locale).
 */

function getLocale(locale: string) {
  return locale === "es" ? es : enUS;
}

/**
 * "lunes 25 de mayo" / "Monday, May 25". Para headers de fechas
 * principales del dashboard.
 */
export function formatLongDate(date: Date, locale: string): string {
  if (locale === "es") {
    return format(date, "EEEE d 'de' MMMM", { locale: es });
  }
  return format(date, "EEEE, MMMM d", { locale: enUS });
}

/**
 * "25 may" / "May 25". Para chips compactos (tareas, due dates).
 */
export function formatShortDate(date: Date, locale: string): string {
  if (locale === "es") {
    return format(date, "d MMM", { locale: es });
  }
  return format(date, "MMM d", { locale: enUS });
}

/**
 * "lun 25 may" / "Mon May 25". Para listas de reservas con día de
 * semana abreviado.
 */
export function formatDayShortDate(date: Date, locale: string): string {
  if (locale === "es") {
    return format(date, "EEE d MMM", { locale: es });
  }
  return format(date, "EEE MMM d", { locale: enUS });
}

/**
 * "25 may 14:30" / "May 25 14:30". Para timestamps cortos con hora —
 * usado en banners de histórico parcial donde indicamos desde qué día
 * y hora empieza la data disponible.
 */
export function formatShortDateTime(date: Date, locale: string): string {
  if (locale === "es") {
    return format(date, "d MMM HH:mm", { locale: es });
  }
  return format(date, "MMM d HH:mm", { locale: enUS });
}

/**
 * Wrapper para `format` que respeta el locale activo. Acepta la format
 * string ICU-style; el `locale` se pasa automáticamente. Útil cuando
 * necesitás un format específico no cubierto por los helpers de arriba.
 */
export function formatLocalized(
  date: Date,
  formatStr: string,
  locale: string,
): string {
  return format(date, formatStr, { locale: getLocale(locale) });
}
