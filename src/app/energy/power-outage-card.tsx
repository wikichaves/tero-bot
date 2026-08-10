import { AlertTriangle, Zap, ZapOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatShortDateTime } from "@/lib/i18n/date";
import type { PropertyOutageSummary } from "@/lib/energy/power-outage-history";

/**
 * WIK-342: tarjeta "snapshot visual de cortes de luz" por propiedad, en
 * /energy. Muestra:
 *   - resumen: N cortes en la ventana (X micro / Y reales) + estado de tensión
 *   - timeline: cada corte con fecha/hora y duración (micro vs real)
 *
 * `locale` viene del server component padre (la vista es server-rendered).
 */
export async function PowerOutageCard({
  propertyName,
  summary,
  locale,
}: {
  propertyName: string;
  summary: PropertyOutageSummary;
  locale: string;
}) {
  const t = await getTranslations("powerOutageCard");
  const { outages, totalOutages, microOutages, realOutages, voltage } = summary;

  // Estado de tensión: sana / baja / sin datos. Umbrales pensados para redes
  // 230V (UY/AR): <205 empieza a ser bajo, <195 preocupante.
  const v = voltage.median;
  const voltageTone =
    v == null ? "muted" : v < 195 ? "danger" : v < 205 ? "warning" : "ok";

  function fmtDuration(min: number | null): string {
    if (min == null) return t("ongoing");
    if (min < 1) return t("seconds");
    if (min < 60) return t("minutes", { n: Math.round(min) });
    const h = min / 60;
    if (h < 24) return t("hours", { n: Math.round(h * 10) / 10 });
    return t("days", { n: Math.round((h / 24) * 10) / 10 });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4 text-amber-500" />
          {t("title", { property: propertyName })}
        </CardTitle>
        <CardDescription>
          {totalOutages === 0
            ? t("noneInWindow")
            : t("summary", {
                total: totalOutages,
                micro: microOutages,
                real: realOutages,
              })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Estado de tensión */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">{t("voltageLabel")}</span>
          {voltage.current != null ? (
            <span className="font-mono tabular-nums">
              {voltage.current.toFixed(0)} V{" "}
              <span className="text-xs text-muted-foreground">
                {t("nowSuffix")}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {voltage.median != null && (
            <span className="text-xs text-muted-foreground">
              {t("voltageRange", {
                min: Math.round(voltage.min ?? 0),
                median: Math.round(voltage.median),
              })}
            </span>
          )}
          {voltageTone !== "muted" && (
            <Badge
              variant={
                voltageTone === "danger"
                  ? "destructive"
                  : voltageTone === "warning"
                    ? "secondary"
                    : "default"
              }
              className="gap-1"
            >
              {voltageTone === "ok" ? (
                <Zap className="h-3 w-3" />
              ) : (
                <ZapOff className="h-3 w-3" />
              )}
              {t(`voltageState.${voltageTone}` as const)}
            </Badge>
          )}
        </div>

        {/* Timeline de cortes */}
        {outages.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {outages.slice(0, 12).map((o, i) => (
              <li
                key={`${o.firedAt}-${i}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  {o.micro ? (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  ) : (
                    <ZapOff className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  )}
                  <span className="tabular-nums">
                    {formatShortDateTime(new Date(o.firedAt), locale)}
                  </span>
                </span>
                <span
                  className={
                    o.micro
                      ? "text-xs text-muted-foreground"
                      : "text-xs font-medium text-destructive"
                  }
                >
                  {o.micro ? t("microTag") : fmtDuration(o.durationMin)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
