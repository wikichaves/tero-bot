import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  formatKwh,
  formatMoney,
  getDefaultTariff,
} from "@/lib/tuya/energy";
import { formatUsd, getRatesToUsd, toUsd } from "@/lib/fx";
import {
  getConsumptionSince,
  startOfDaysAgoIso,
  startOfTodayIso,
} from "@/lib/tuya/snapshots";
import type { Property } from "@/lib/types";

type PropertyRow = Pick<
  Property,
  "id" | "name" | "currency" | "tariff_per_kwh"
>;

type DeviceRow = {
  id: string;
  property_id: string;
  device_kind: string;
  is_primary: boolean;
};

/**
 * Build a WhatsApp-friendly consumption report. If `propertyFilter` is set
 * (case-insensitive substring), only that property is included; otherwise
 * report covers all properties.
 *
 * Returns plain text with WhatsApp markdown (`*bold*`, `_italic_`) — ready
 * to send via `sendKapsoText`.
 */
export async function buildConsumptionReport(opts?: {
  propertyFilter?: string | null;
}): Promise<string> {
  const admin = createAdminClient();
  const [propsRes, devicesRes] = await Promise.all([
    admin.from("properties").select("id, name, currency, tariff_per_kwh"),
    admin
      .from("property_devices")
      .select("id, property_id, device_kind, is_primary"),
  ]);
  const properties = (propsRes.data ?? []) as PropertyRow[];
  const devices = (devicesRes.data ?? []) as DeviceRow[];

  const filter = opts?.propertyFilter?.trim().toLowerCase();
  const visible = filter
    ? properties.filter((p) => p.name.toLowerCase().includes(filter))
    : properties;

  if (visible.length === 0) {
    if (filter) {
      return `No encontré una propiedad que coincida con "${opts?.propertyFilter}". Probá sin filtro o con otro nombre.`;
    }
    return "No hay propiedades cargadas todavía.";
  }

  // FX rates for all currencies present.
  const fxRates = await getRatesToUsd(
    visible.map((p) => p.currency).concat(["USD"]),
  );
  const defaultTariff = getDefaultTariff();
  const todayIso = startOfTodayIso();
  const sevenDaysAgoIso = startOfDaysAgoIso(7);

  type PerProperty = {
    name: string;
    currency: string;
    tariff: number;
    today_kwh: number;
    week_kwh: number;
    today_local: number;
    week_local: number;
    today_usd: number;
    week_usd: number;
  };

  const perProperty: PerProperty[] = await Promise.all(
    visible.map(async (p) => {
      // Aggregate consumption across all devices in this property (typically
      // there's just one circuit breaker but be defensive).
      const propertyDevices = devices.filter((d) => d.property_id === p.id);
      let today_kwh = 0;
      let week_kwh = 0;
      for (const d of propertyDevices) {
        const [today, week] = await Promise.all([
          getConsumptionSince(d.id, todayIso),
          getConsumptionSince(d.id, sevenDaysAgoIso),
        ]);
        if (today.delta_kwh != null) today_kwh += today.delta_kwh;
        if (week.delta_kwh != null) week_kwh += week.delta_kwh;
      }
      const tariff =
        p.tariff_per_kwh && p.tariff_per_kwh > 0
          ? Number(p.tariff_per_kwh)
          : defaultTariff;
      const fx = fxRates.get(p.currency);
      const today_local = today_kwh * tariff;
      const week_local = week_kwh * tariff;
      const today_usd = toUsd(today_local, fx) ?? 0;
      const week_usd = toUsd(week_local, fx) ?? 0;
      return {
        name: p.name,
        currency: p.currency,
        tariff,
        today_kwh,
        week_kwh,
        today_local,
        week_local,
        today_usd,
        week_usd,
      };
    }),
  );

  // Build the message.
  const lines: string[] = [];
  lines.push("🌲 *Consumo Acme Rentals*");
  lines.push("");

  // Today section
  lines.push("*Hoy* (desde 00:00):");
  let totalTodayUsd = 0;
  let anyTodayData = false;
  for (const p of perProperty) {
    if (p.today_kwh === 0 && p.today_local === 0) {
      lines.push(
        `• ${p.name}: _sin datos suficientes_ (necesita 2+ snapshots)`,
      );
      continue;
    }
    anyTodayData = true;
    totalTodayUsd += p.today_usd;
    lines.push(
      `• ${p.name}: ${formatKwh(p.today_kwh, 1)} — ${formatMoney(p.today_local, p.currency)} (${formatUsd(p.today_usd)})`,
    );
  }
  if (anyTodayData && perProperty.length > 1) {
    lines.push(`• *Total: ${formatUsd(totalTodayUsd)}*`);
  }
  lines.push("");

  // 7 days section
  lines.push("*Últimos 7 días*:");
  let totalWeekUsd = 0;
  let anyWeekData = false;
  for (const p of perProperty) {
    if (p.week_kwh === 0 && p.week_local === 0) {
      lines.push(`• ${p.name}: _sin datos_`);
      continue;
    }
    anyWeekData = true;
    totalWeekUsd += p.week_usd;
    lines.push(
      `• ${p.name}: ${formatKwh(p.week_kwh, 1)} — ${formatMoney(p.week_local, p.currency)} (${formatUsd(p.week_usd)})`,
    );
  }
  if (anyWeekData && perProperty.length > 1) {
    lines.push(`• *Total: ${formatUsd(totalWeekUsd)}*`);
  }
  lines.push("");

  // Footer
  const arsRate = fxRates.get("ARS")?.per_usd;
  const uyuRate = fxRates.get("UYU")?.per_usd;
  if (arsRate || uyuRate) {
    const parts: string[] = [];
    if (uyuRate) parts.push(`UYU ${uyuRate.toFixed(2)}`);
    if (arsRate) parts.push(`ARS ${arsRate.toFixed(0)} (blue)`);
    lines.push(`_Cambio del día: 1 USD ≈ ${parts.join(" · ")}_`);
  }

  return lines.join("\n").trim();
}
