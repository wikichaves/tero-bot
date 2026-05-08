import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  formatKwh,
  formatMoney,
  getDefaultTariff,
} from "@/lib/tuya/energy";
import { formatUsd, getRatesToUsd, prewarmFx, toUsd } from "@/lib/fx";
import {
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
  console.time("[consumo] total");
  const admin = createAdminClient();

  // Fire FX in parallel with the DB queries — we don't yet know which
  // currencies are in `visible`, but we pre-fetch the common set (USD +
  // ARS + UYU). When `getRatesToUsd` is called below it'll mostly hit the
  // in-memory cache. Saves ~500ms-1s on warm instances.
  const fxPrefetch = getRatesToUsd(["USD", "ARS", "UYU"]);

  // Pull properties, devices, AND the set of devices that actually have
  // snapshots in the last 7 days — all in parallel. Without the third
  // query we'd loop over ALL property_devices (locks, switches, etc.)
  // and fire 4 useless queries per non-energy device. With it, we filter
  // up-front to just devices with energy data, cutting ~90% of round
  // trips on accounts with mixed device types.
  const sevenDaysAgoIso = startOfDaysAgoIso(7);
  console.time("[consumo] db.properties+devices+snapshot-ids");
  const [propsRes, devicesRes, snapDevicesRes] = await Promise.all([
    admin.from("properties").select("id, name, currency, tariff_per_kwh"),
    admin
      .from("property_devices")
      .select("id, property_id, device_kind, is_primary"),
    admin
      .from("energy_snapshots")
      .select("property_device_id")
      .gte("taken_at", sevenDaysAgoIso),
  ]);
  console.timeEnd("[consumo] db.properties+devices+snapshot-ids");
  const properties = (propsRes.data ?? []) as PropertyRow[];
  const allDevices = (devicesRes.data ?? []) as DeviceRow[];
  const energyDeviceIds = new Set(
    (snapDevicesRes.data ?? []).map(
      (r) => (r as { property_device_id: string }).property_device_id,
    ),
  );
  const devices = allDevices.filter((d) => energyDeviceIds.has(d.id));

  const filter = opts?.propertyFilter?.trim().toLowerCase();
  const visible = filter
    ? properties.filter((p) => p.name.toLowerCase().includes(filter))
    : properties;

  if (visible.length === 0) {
    console.timeEnd("[consumo] total");
    if (filter) {
      return `No encontré una propiedad que coincida con "${opts?.propertyFilter}". Probá sin filtro o con otro nombre.`;
    }
    return "No hay propiedades cargadas todavía.";
  }

  const defaultTariff = getDefaultTariff();
  const todayIso = startOfTodayIso();
  // sevenDaysAgoIso already declared above for the snapshot-ids query.

  type PerPropertyRaw = {
    name: string;
    currency: string;
    tariff: number;
    today_kwh: number;
    week_kwh: number;
  };

  // Run FX fetch and ONE batched snapshot query CONCURRENTLY. Previously
  // we did 4 queries per device (getConsumptionSince × 2 windows × first/
  // last) → up to 92 round trips on accounts with many non-energy devices.
  // Now: a single query pulls all snapshots in the 7-day window for the
  // pre-filtered energy devices, and we compute first/last in JS.
  console.time("[consumo] fx + batched snapshots (parallel)");
  const visibleDeviceIds = devices
    .filter((d) => visible.some((p) => p.id === d.property_id))
    .map((d) => d.id);
  const [fxRates, snapshotsRes] = await Promise.all([
    (async () => {
      await fxPrefetch;
      return getRatesToUsd(
        visible.map((p) => p.currency).concat(["USD"]),
      );
    })(),
    visibleDeviceIds.length > 0
      ? admin
          .from("energy_snapshots")
          .select("property_device_id, taken_at, total_energy_kwh")
          .in("property_device_id", visibleDeviceIds)
          .gte("taken_at", sevenDaysAgoIso)
          .not("total_energy_kwh", "is", null)
          .order("taken_at", { ascending: true })
      : Promise.resolve({ data: [] as Array<never> }),
  ]);
  console.timeEnd("[consumo] fx + batched snapshots (parallel)");

  type SnapRow = {
    property_device_id: string;
    taken_at: string;
    total_energy_kwh: number | null;
  };
  const snapshots = (snapshotsRes.data ?? []) as SnapRow[];

  // Reduce snapshots to first/last per (device, window).
  const firstWeek = new Map<string, SnapRow>();
  const lastWeek = new Map<string, SnapRow>();
  const firstToday = new Map<string, SnapRow>();
  const lastToday = new Map<string, SnapRow>();
  for (const row of snapshots) {
    if (!firstWeek.has(row.property_device_id)) {
      firstWeek.set(row.property_device_id, row);
    }
    lastWeek.set(row.property_device_id, row);
    if (row.taken_at >= todayIso) {
      if (!firstToday.has(row.property_device_id)) {
        firstToday.set(row.property_device_id, row);
      }
      lastToday.set(row.property_device_id, row);
    }
  }
  const computeDelta = (
    first?: SnapRow,
    last?: SnapRow,
  ): number => {
    if (
      !first ||
      !last ||
      first.total_energy_kwh == null ||
      last.total_energy_kwh == null ||
      last.total_energy_kwh < first.total_energy_kwh
    ) {
      return 0;
    }
    return last.total_energy_kwh - first.total_energy_kwh;
  };

  const perPropertyRaw: PerPropertyRaw[] = visible.map((p) => {
    const propertyDevices = devices.filter((d) => d.property_id === p.id);
    let today_kwh = 0;
    let week_kwh = 0;
    for (const d of propertyDevices) {
      today_kwh += computeDelta(firstToday.get(d.id), lastToday.get(d.id));
      week_kwh += computeDelta(firstWeek.get(d.id), lastWeek.get(d.id));
    }
    const tariff =
      p.tariff_per_kwh && p.tariff_per_kwh > 0
        ? Number(p.tariff_per_kwh)
        : defaultTariff;
    return {
      name: p.name,
      currency: p.currency,
      tariff,
      today_kwh,
      week_kwh,
    };
  });
  // Kick off the next request's FX prewarm — cheap if cache is hot.
  prewarmFx();

  // Apply tariff + FX conversion (CPU-only, fast).
  const perProperty = perPropertyRaw.map((p) => {
    const fx = fxRates.get(p.currency);
    const today_local = p.today_kwh * p.tariff;
    const week_local = p.week_kwh * p.tariff;
    const today_usd = toUsd(today_local, fx) ?? 0;
    const week_usd = toUsd(week_local, fx) ?? 0;
    return {
      ...p,
      today_local,
      week_local,
      today_usd,
      week_usd,
    };
  });

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

  console.timeEnd("[consumo] total");
  return lines.join("\n").trim();
}
