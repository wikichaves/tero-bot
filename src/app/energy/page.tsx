import Link from "next/link";
import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  getDefaultTariff,
  getDeviceStatus,
  isEnergyDevice,
  parseEnergyReading,
  type EnergyReading,
} from "@/lib/tuya/energy";
import {
  listAllDevices,
  listDevicesGroupedByHome,
  type TuyaDevice,
} from "@/lib/tuya/devices";
import { listPropertyDeviceMap } from "@/lib/tuya/property-devices";
import { formatRate, getRatesToUsd, type FxRate } from "@/lib/fx";
import {
  getConsumptionSince,
  maybeSnapshotIfStale,
  startOfTodayIso,
} from "@/lib/tuya/snapshots";
import {
  computeTuyaConsumption,
  deltaLevel,
} from "@/lib/bills/tuya-comparison";
import {
  enrichWithEffectivePeriod,
  type BillRow,
  type BillRowDerived,
} from "@/lib/bills/enrich-period";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import type { Property } from "@/lib/types";
import { SnapshotButton } from "./snapshot-button";
import { BackfillButton } from "./backfill-button";
import { DeviceEnergyCard } from "./device-energy-card";
import type { BillComparison } from "./bill-comparisons-table";

// El tipo `BillComparison` ahora vive en `bill-comparisons-table.tsx`
// junto con el componente que lo consume — se importa arriba.

export const dynamic = "force-dynamic";

// WIK-99: rangos seleccionables del histórico de consumo. Default 24h.
const RANGES = {
  "24h": { hours: 24 },
  "7d": { hours: 7 * 24 },
  "30d": { hours: 30 * 24 },
} as const;
type RangeKey = keyof typeof RANGES;

// El switch de moneda ahora vive POR CARD (cada device tiene su currency
// según property). El de métrica (Amperes/kWh) también es per-card. Acá
// arriba sólo queda el toggle de rango (24h/7d/30d).

type PropertySummary = Pick<
  Property,
  "id" | "name" | "currency" | "tariff_per_kwh" | "sort_order"
>;

type DeviceWithContext = {
  device: TuyaDevice;
  homeName: string | null;
  property: PropertySummary | null;
  /** property_devices.id (only if device is assigned). */
  propertyDeviceId: string | null;
  reading: EnergyReading | null;
  readError: string | null;
  /** Effective tariff used for cost calc (property override or default). */
  tariff: number;
  /** ISO 4217 currency for display. */
  currency: string;
  /** Consumption today (kWh delta) since 00:00 local. */
  todayKwh: number | null;
  /** Consumption over the selected range (24h / 7d / 30d). */
  rangeKwh: number | null;
  /** ISO timestamp of the first snapshot found within the range, if any.
   *  Used to detect partial history. */
  rangeFirstSnapshotIso: string | null;
  /** Snapshots ordenados por timestamp para alimentar el chart. */
  rangeSnapshots: Array<{
    ts: number;
    power_w: number | null;
    current_a: number | null;
    total_energy_kwh: number | null;
  }>;
  /** Facturas de luz con período + kWh facturado para la propiedad del
   *  device, comparadas contra el consumo Tuya en el mismo período. (WIK-75) */
  billComparisons: BillComparison[];
  /** True si la property no tiene tariff configurada y usamos el default. */
  isDefaultTariff: boolean;
};

export default async function EnergyPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const t = await getTranslations("energyPage");
  const defaultTariff = getDefaultTariff();
  const sp = await searchParams;
  const range: RangeKey =
    sp.range === "7d" || sp.range === "30d" ? sp.range : "24h";
  // Capturamos `nowMs` UNA sola vez en el server y lo pasamos al cliente
  // como prop. Si lo calculáramos en el client (durante SSR + después en
  // hydration) daría timestamps distintos → React #418 hydration mismatch.
  const nowMs = Date.now();
  const rangeMs = RANGES[range].hours * 60 * 60 * 1000;
  const rangeStartMs = nowMs - rangeMs;
  const rangeSinceIso = new Date(rangeStartMs).toISOString();
  // Fetch starting ONE HOUR before the range so the line in the chart
  // enters from the axis edge instead of starting cleanly inside the
  // window. Snapshots are taken on the hour, so without this the first
  // snapshot inside a 24h window can be 30-60 min after the axis start,
  // producing a visible gap. Recharts' XAxis `domain` keeps the visible
  // range fixed; the extra leading point just extends the line.
  const fetchSinceIso = new Date(rangeStartMs - 60 * 60 * 1000).toISOString();

  // Take a fresh snapshot if the latest is over an hour old. This is the
  // primary capture mechanism on Vercel's Hobby plan (cron is daily-only).
  // Best-effort, fire-and-forget — errors don't block rendering.
  await maybeSnapshotIfStale(60).catch(() => null);

  const [flatRes, groupedRes] = await Promise.all([
    listAllDevices().catch((err: Error) => ({ error: err.message })),
    listDevicesGroupedByHome().catch((err: Error) => ({ error: err.message })),
  ]);

  if ("error" in flatRes) {
    return (
      <div className="flex flex-col gap-6">
        <Header range={range} />
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            {t("tuyaError", { error: flatRes.error })}
          </CardContent>
        </Card>
      </div>
    );
  }

  const homeNameByDeviceId = new Map<string, string>();
  if (!("error" in groupedRes)) {
    for (const { home, devices } of groupedRes.homes) {
      for (const d of devices) {
        homeNameByDeviceId.set(d.id, home.name);
      }
    }
  }

  const energyDevices = flatRes.devices.filter(isEnergyDevice);

  // WIK-94: scope por property — gestor solo ve sus properties.
  const profile = await requireProfile();
  const allowedIds = await getAllowedPropertyIds(profile);

  const supabase = await createClient();
  let propsQuery = supabase
    .from("properties")
    .select("id, name, currency, tariff_per_kwh, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (allowedIds !== null) propsQuery = propsQuery.in("id", allowedIds);

  let billsQuery = supabase
    .from("utility_bills")
    .select("*, property:properties(id, name, currency)")
    .eq("utility_type", "luz")
    .not("kwh_billed", "is", null)
    .order("due_date", { ascending: false, nullsFirst: false });
  if (allowedIds !== null) billsQuery = billsQuery.in("property_id", allowedIds);

  const [propertiesRes, deviceMap, billsRes] = await Promise.all([
    propsQuery,
    listPropertyDeviceMap(),
    billsQuery,
  ]);
  const properties = (propertiesRes.data ?? []) as PropertySummary[];
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  // Enriquecemos con effective_period_from/to igual que /bills, para que
  // facturas sin período explícito puedan compararse usando el período
  // inferido (due_date anterior → due_date actual). (WIK-75)
  const rawBills = (billsRes.data ?? []) as BillRow[];
  const enrichedBills = enrichWithEffectivePeriod(rawBills);
  const billsByProperty = new Map<string, BillRowDerived[]>();
  for (const b of enrichedBills) {
    const list = billsByProperty.get(b.property_id) ?? [];
    list.push(b);
    billsByProperty.set(b.property_id, list);
  }
  const admin = createAdminClient();

  // Snapshots de todos los devices energéticos dentro del rango — única
  // query, agrupamos in-memory por property_device_id. Limit explícito
  // (mismo bug que /rooms: el default de Supabase es 1000 y para
  // 30d × varios devices ya nos pasamos).
  const energyPropertyDeviceIds = energyDevices
    .map((d) => deviceMap.get(d.id)?.id)
    .filter((id): id is string => typeof id === "string");
  const snapshotsByDeviceMap = new Map<
    string,
    Array<{
      ts: number;
      power_w: number | null;
      current_a: number | null;
      total_energy_kwh: number | null;
    }>
  >();
  if (energyPropertyDeviceIds.length > 0) {
    const { data: rangeSnaps } = await admin
      .from("energy_snapshots")
      .select(
        "property_device_id, taken_at, power_w, current_a, total_energy_kwh",
      )
      .in("property_device_id", energyPropertyDeviceIds)
      .gte("taken_at", fetchSinceIso)
      .order("taken_at", { ascending: true })
      .limit(100_000);
    for (const s of (rangeSnaps ?? []) as Array<{
      property_device_id: string;
      taken_at: string;
      power_w: number | null;
      current_a: number | null;
      total_energy_kwh: number | null;
    }>) {
      const list = snapshotsByDeviceMap.get(s.property_device_id) ?? [];
      list.push({
        ts: new Date(s.taken_at).getTime(),
        power_w: s.power_w,
        current_a: s.current_a,
        total_energy_kwh: s.total_energy_kwh,
      });
      snapshotsByDeviceMap.set(s.property_device_id, list);
    }
  }

  const todayIso = startOfTodayIso();

  const devicesWithContext: DeviceWithContext[] = await Promise.all(
    energyDevices.map(async (device) => {
      const assignment = deviceMap.get(device.id);
      const property = assignment
        ? (propertyById.get(assignment.property_id) ?? null)
        : null;
      const tariff =
        property?.tariff_per_kwh && property.tariff_per_kwh > 0
          ? Number(property.tariff_per_kwh)
          : defaultTariff;
      const currency = property?.currency ?? "UYU";

      let reading: EnergyReading | null = null;
      let readError: string | null = null;
      try {
        const status = await getDeviceStatus(device.id);
        reading = parseEnergyReading(status);
      } catch (e) {
        readError = (e as Error).message;
      }

      // Pull historical consumption (only meaningful if device is assigned —
      // we key snapshots by property_device_id).
      let todayKwh: number | null = null;
      let rangeKwh: number | null = null;
      let rangeFirstSnapshotIso: string | null = null;
      if (assignment?.id) {
        const [today, rangeRes] = await Promise.all([
          getConsumptionSince(assignment.id, todayIso),
          getConsumptionSince(assignment.id, rangeSinceIso),
        ]);
        todayKwh = today.delta_kwh;
        rangeKwh = rangeRes.delta_kwh;
        rangeFirstSnapshotIso = rangeRes.first?.taken_at ?? null;
      }

      // Bill-vs-Tuya comparisons para esta propiedad (las últimas hasta 6
      // facturas con período resolvible — más allá de eso la coverage del
      // snapshot Tuya cae a 0% porque no teníamos historia).
      let billComparisons: BillComparison[] = [];
      if (property) {
        const candidates = (billsByProperty.get(property.id) ?? [])
          .filter(
            (b) =>
              b.effective_period_from &&
              b.effective_period_to &&
              b.kwh_billed != null,
          )
          .slice(0, 6);
        const computed = await Promise.all(
          candidates.map(async (bill) => {
            const r = await computeTuyaConsumption(
              admin,
              bill.property_id,
              bill.effective_period_from!,
              bill.effective_period_to!,
            );
            if (!r || r.kwh <= 0) return null;
            const deltaPct = ((bill.kwh_billed! - r.kwh) / r.kwh) * 100;
            return {
              bill,
              tuyaKwh: r.kwh,
              deltaPct,
              level: deltaLevel(deltaPct),
              coverageFraction: r.coverageFraction,
            } satisfies BillComparison;
          }),
        );
        billComparisons = computed.filter((x): x is BillComparison => x != null);
      }

      return {
        device,
        homeName: homeNameByDeviceId.get(device.id) ?? null,
        property,
        propertyDeviceId: assignment?.id ?? null,
        reading,
        readError,
        tariff,
        currency,
        todayKwh,
        rangeKwh,
        rangeFirstSnapshotIso,
        rangeSnapshots: assignment?.id
          ? (snapshotsByDeviceMap.get(assignment.id) ?? [])
          : [],
        billComparisons,
        isDefaultTariff:
          !property?.tariff_per_kwh || property.tariff_per_kwh <= 0,
      };
    }),
  );

  // Respect the admin's manual property order (the same one shown in
  // /admin/properties via the ↑↓ arrows). Devices without an assigned
  // property fall to the bottom. Within a property, keep device.name
  // alphabetical for stability.
  devicesWithContext.sort((a, b) => {
    const aOrder = a.property?.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.property?.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a.device.name ?? "").localeCompare(b.device.name ?? "");
  });

  // Fetch USD exchange rates. Incluimos UYU+ARS+USD siempre (no sólo
  // las monedas de properties) — el switch de unidad permite ver
  // costos en cualquiera de las tres, independiente de cuál sea la
  // moneda local de cada device.
  const distinctCurrencies = new Set([
    ...devicesWithContext.map((d) => d.currency),
    "UYU",
    "ARS",
    "USD",
  ]);
  const fxRates = await getRatesToUsd(distinctCurrencies);

  const rangeLabel = t(`ranges.${range}` as const);
  const rangeShortLabel = t(`rangesShort.${range}` as const);

  return (
    <div className="flex flex-col gap-6">
      <Header range={range} />

      {devicesWithContext.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground space-y-2">
            <p>{t("noDevicesP1", { n: flatRes.devices.length })}</p>
            <p>
              {t("noDevicesP2Pre")}
              <code>dlq</code>
              {t("noDevicesP2Mid1")}
              <code>pc</code>
              {t("noDevicesP2Mid1")}
              <code>znyk</code>
              {t("noDevicesP2Mid2")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {devicesWithContext.map((d) => (
            <DeviceEnergyCard
              key={d.device.id}
              ctx={d}
              fxRates={fxRates}
              nowMs={nowMs}
              rangeStartMs={rangeStartMs}
              rangeLabel={rangeLabel}
              rangeShortLabel={rangeShortLabel}
            />
          ))}

          <FxFooter rates={fxRates} />
        </>
      )}
    </div>
  );
}

async function Header({ range }: { range: RangeKey }) {
  const t = await getTranslations("energyPage");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitlePre")}
            <a
              href="/admin/properties"
              className="underline hover:text-foreground"
            >
              {t("subtitleLink")}
            </a>
            {t("subtitlePost")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SnapshotButton />
          <BackfillButton />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(RANGES) as RangeKey[]).map((r) => (
          <Link
            key={r}
            href={r === "24h" ? "/energy" : `/energy?range=${r}`}
          >
            <Button
              variant={range === r ? "default" : "outline"}
              size="sm"
            >
              {t(`ranges.${r}` as const)}
            </Button>
          </Link>
        ))}
      </div>
    </div>
  );
}

async function FxFooter({ rates }: { rates: Map<string, FxRate> }) {
  const t = await getTranslations("energyPage");
  const nonUsd = Array.from(rates.values()).filter((r) => r.currency !== "USD");
  if (nonUsd.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {t("fxRates")}
      {nonUsd
        .map((r) => `1 USD ≈ ${formatRate(r.per_usd, 2)} ${r.currency}`)
        .join(" · ")}
      {" — "}
      <em>
        {Array.from(new Set(nonUsd.map((r) => r.source))).join(", ")}
      </em>
    </p>
  );
}
