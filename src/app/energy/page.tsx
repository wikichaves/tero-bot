import Link from "next/link";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  estimateCost,
  formatKwh,
  formatMoney,
  formatNumeric,
  formatPower,
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
  startOfDaysAgoIso,
  startOfTodayIso,
} from "@/lib/tuya/snapshots";
import {
  computeTuyaConsumption,
  deltaLevel,
  type DeltaLevel,
} from "@/lib/bills/tuya-comparison";
import {
  enrichWithEffectivePeriod,
  type BillRow,
  type BillRowDerived,
} from "@/lib/bills/enrich-period";
import { DeltaBadge } from "@/components/bills/delta-badge";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import type { Property } from "@/lib/types";
import { SnapshotButton } from "./snapshot-button";
import { BackfillButton } from "./backfill-button";
import { DeviceEnergyChart } from "./device-energy-chart";

/**
 * Comparativa de una factura de luz contra el consumo medido por Tuya
 * en el mismo período. Se renderiza dentro del DeviceEnergyCard cuando
 * el device está asignado a una propiedad que tiene facturas con
 * período + kWh facturado. (WIK-75 — antes esto vivía como columna en
 * /facturas, pero la mayoría de las filas no aplicaba.)
 */
type BillComparison = {
  bill: BillRowDerived;
  tuyaKwh: number;
  deltaPct: number;
  level: DeltaLevel;
  coverageFraction: number;
};

export const dynamic = "force-dynamic";

// WIK-99: rangos seleccionables del histórico de consumo. Default 24h.
const RANGES = {
  "24h": { hours: 24, label: "24 horas", shortLabel: "24h" },
  "7d": { hours: 7 * 24, label: "7 días", shortLabel: "7d" },
  "30d": { hours: 30 * 24, label: "30 días", shortLabel: "30d" },
} as const;
type RangeKey = keyof typeof RANGES;

// WIK-99 F4: unidades del switch.
//   - "kwh": muestra sólo el consumo en kWh (sin costos)
//   - "UYU"/"ARS"/"USD": muestra costos en esa moneda (convertido vía FX)
const UNITS = ["kwh", "UYU", "ARS", "USD"] as const;
type UnitKey = (typeof UNITS)[number];
const UNIT_LABELS: Record<UnitKey, string> = {
  kwh: "kWh",
  UYU: "UYU",
  ARS: "ARS",
  USD: "USD",
};

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
  /** Snapshots ordenados por timestamp para alimentar el mini-chart. */
  rangeSnapshots: Array<{ ts: number; power_w: number | null }>;
  /** Facturas de luz con período + kWh facturado para la propiedad del
   *  device, comparadas contra el consumo Tuya en el mismo período. (WIK-75) */
  billComparisons: BillComparison[];
};

export default async function EnergyPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; unit?: string }>;
}) {
  const defaultTariff = getDefaultTariff();
  const sp = await searchParams;
  const range: RangeKey =
    sp.range === "7d" || sp.range === "30d" ? sp.range : "24h";
  const unit: UnitKey =
    sp.unit === "kwh" ||
    sp.unit === "UYU" ||
    sp.unit === "ARS" ||
    sp.unit === "USD"
      ? sp.unit
      : "UYU"; // default a la moneda local más común
  const rangeSinceIso = new Date(
    Date.now() - RANGES[range].hours * 60 * 60 * 1000,
  ).toISOString();

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
        <Header range={range} unit={unit} />
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            No se pudo hablar con Tuya: {flatRes.error}
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

  // Enriquecemos con effective_period_from/to igual que /facturas, para que
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
  // (mismo bug que /ambientes: el default de Supabase es 1000 y para
  // 30d × varios devices ya nos pasamos).
  const energyPropertyDeviceIds = energyDevices
    .map((d) => deviceMap.get(d.id)?.id)
    .filter((id): id is string => typeof id === "string");
  const snapshotsByDeviceMap = new Map<
    string,
    Array<{ ts: number; power_w: number | null }>
  >();
  if (energyPropertyDeviceIds.length > 0) {
    const { data: rangeSnaps } = await admin
      .from("energy_snapshots")
      .select("property_device_id, taken_at, power_w")
      .in("property_device_id", energyPropertyDeviceIds)
      .gte("taken_at", rangeSinceIso)
      .order("taken_at", { ascending: true })
      .limit(100_000);
    for (const s of (rangeSnaps ?? []) as Array<{
      property_device_id: string;
      taken_at: string;
      power_w: number | null;
    }>) {
      const list = snapshotsByDeviceMap.get(s.property_device_id) ?? [];
      list.push({
        ts: new Date(s.taken_at).getTime(),
        power_w: s.power_w,
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

  return (
    <div className="flex flex-col gap-6">
      <Header range={range} unit={unit} />

      {devicesWithContext.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground space-y-2">
            <p>
              No se encontraron dispositivos identificables como medidores
              de consumo entre los {flatRes.devices.length} devices del cloud
              project.
            </p>
            <p>
              Buscamos por categoría <code>dlq</code> / <code>pc</code> /{" "}
              <code>znyk</code> o nombre que contenga &ldquo;Circuit breaker&rdquo; /
              &ldquo;breaker&rdquo; / &ldquo;Térmica&rdquo;.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {devicesWithContext.map((d) => (
            <DeviceEnergyCard
              key={d.device.id}
              ctx={d}
              fx={fxRates.get(d.currency)}
              fxRates={fxRates}
              range={range}
              unit={unit}
            />
          ))}

          <FxFooter rates={fxRates} />
        </>
      )}
    </div>
  );
}

function Header({ range, unit }: { range: RangeKey; unit: UnitKey }) {
  // Helper para construir el href manteniendo el otro searchParam intacto.
  function hrefWith(nextRange: RangeKey, nextUnit: UnitKey): string {
    const params = new URLSearchParams();
    if (nextRange !== "24h") params.set("range", nextRange);
    if (nextUnit !== "UYU") params.set("unit", nextUnit);
    const q = params.toString();
    return q ? `/energy?${q}` : "/energy";
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Energía</h1>
          <p className="text-sm text-muted-foreground">
            Consumo en vivo por propiedad. Histórico vía snapshots horarios.
            Tarifa y moneda se configuran por propiedad en{" "}
            <a
              href="/admin/properties"
              className="underline hover:text-foreground"
            >
              /admin/properties
            </a>
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SnapshotButton />
          <BackfillButton />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(RANGES) as RangeKey[]).map((r) => (
          <Link key={r} href={hrefWith(r, unit)}>
            <Button variant={range === r ? "default" : "outline"} size="sm">
              {RANGES[r].label}
            </Button>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {UNITS.map((u) => (
          <Link key={u} href={hrefWith(range, u)}>
            <Button
              variant={unit === u ? "default" : "outline"}
              size="sm"
            >
              {UNIT_LABELS[u]}
            </Button>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FxFooter({ rates }: { rates: Map<string, FxRate> }) {
  const nonUsd = Array.from(rates.values()).filter((r) => r.currency !== "USD");
  if (nonUsd.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Tasas de cambio:{" "}
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

function DeviceEnergyCard({
  ctx,
  fx,
  fxRates,
  range,
  unit,
}: {
  ctx: DeviceWithContext;
  fx: FxRate | undefined;
  fxRates: Map<string, FxRate>;
  range: RangeKey;
  unit: UnitKey;
}) {
  /**
   * Convierte un monto en `fromCurrency` a la unidad seleccionada. Si
   * `unit === "kwh"` retorna null (los costos no se muestran en modo kWh).
   * Pasa por USD como bridge: local → USD → target.
   */
  function formatInUnit(
    localAmount: number | null,
    fromCurrency: string,
  ): string | null {
    if (localAmount == null) return null;
    if (unit === "kwh") return null;
    const fromFx = fxRates.get(fromCurrency.toUpperCase());
    const toFx = fxRates.get(unit);
    if (!fromFx || !toFx) return null;
    const usd = localAmount / fromFx.per_usd;
    const target = usd * toFx.per_usd;
    return formatMoney(target, unit);
  }
  const {
    device,
    homeName,
    property,
    reading,
    readError,
    tariff,
    currency,
    todayKwh,
    rangeKwh,
    rangeFirstSnapshotIso,
    rangeSnapshots,
    billComparisons,
  } = ctx;

  // Histórico parcial: threshold proporcional (10% del rango). Para 24h
  // pita si faltan >2.4h, para 7d si faltan >17h, para 30d si faltan
  // >3d. Threshold mínimo de 1h para que no pite por gaps insignificantes.
  const rangeMs = RANGES[range].hours * 60 * 60 * 1000;
  const rangeStartTs = Date.now() - rangeMs;
  const HISTORICAL_GAP_THRESHOLD_MS = Math.max(
    60 * 60 * 1000,
    rangeMs * 0.1,
  );
  const hasIncompleteHistory =
    rangeFirstSnapshotIso != null &&
    new Date(rangeFirstSnapshotIso).getTime() - rangeStartTs >
      HISTORICAL_GAP_THRESHOLD_MS;
  const cost = reading
    ? estimateCost(reading, tariff, currency)
    : {
        total_cost: null,
        daily_cost_at_current: null,
        hourly_cost_at_current: null,
        tariff_per_kwh: tariff,
        currency,
      };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              {device.name}
              <Badge variant={device.online ? "default" : "secondary"}>
                {device.online ? "online" : "offline"}
              </Badge>
            </CardTitle>
            <CardDescription>
              {homeName && (
                <>
                  Home: <strong>{homeName}</strong>
                </>
              )}
              {homeName && property && " · "}
              {property && (
                <>
                  Propiedad: <strong>{property.name}</strong>
                </>
              )}
              {!homeName && !property && (
                <span className="text-muted-foreground">Sin asignar</span>
              )}
            </CardDescription>
          </div>
          <p className="text-xs text-muted-foreground text-right">
            Tarifa:
            <br />
            <span className="font-mono">
              {formatRate(tariff, 2)} {currency}/kWh
            </span>
            {(!property?.tariff_per_kwh || property.tariff_per_kwh <= 0) && (
              <>
                <br />
                <span className="text-amber-700 dark:text-amber-300">
                  (default)
                </span>
              </>
            )}
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {/* Stats en vivo: sólo cuando el device está online con lectura.
            Si está offline o no hay reading, ocultamos este bloque pero
            seguimos mostrando histórico abajo. */}
        {readError ? (
          <p className="text-sm text-destructive">
            No se pudo leer el estado en vivo: {readError}
          </p>
        ) : !device.online ? (
          <p className="text-sm text-muted-foreground">
            🔌 Device offline — sin lectura en vivo. Los datos históricos
            siguen abajo.
          </p>
        ) : !reading ||
          (reading.power_w == null && reading.total_energy_kwh == null) ? (
          <p className="text-sm text-muted-foreground">
            Tuya no devolvió datos de potencia/energía en vivo.
          </p>
        ) : unit === "kwh" ? (
          // Modo kWh: ocultamos los stats de costo y mostramos sólo las
          // métricas energéticas crudas.
          <div className="grid gap-4 sm:grid-cols-2">
            <Stat
              label="Potencia"
              value={formatPower(reading.power_w)}
              hint={
                reading.voltage_v != null && reading.current_a != null
                  ? `${formatNumeric(reading.voltage_v, "V", 0)} · ${formatNumeric(reading.current_a, "A", 1)}`
                  : undefined
              }
            />
            <Stat
              label="Acumulado total"
              value={formatKwh(reading.total_energy_kwh)}
            />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <Stat
              label="Potencia"
              value={formatPower(reading.power_w)}
              hint={
                reading.voltage_v != null && reading.current_a != null
                  ? `${formatNumeric(reading.voltage_v, "V", 0)} · ${formatNumeric(reading.current_a, "A", 1)}`
                  : undefined
              }
            />
            <Stat
              label={`Costo / hora · ${unit}`}
              value={
                formatInUnit(cost.hourly_cost_at_current, currency) ?? "—"
              }
            />
            <Stat
              label={`Proyección 24 h · ${unit}`}
              value={
                formatInUnit(cost.daily_cost_at_current, currency) ?? "—"
              }
              hint="si se mantiene este consumo"
            />
            <Stat
              label="Acumulado total"
              value={formatKwh(reading.total_energy_kwh)}
              hint={formatInUnit(cost.total_cost, currency) ?? undefined}
            />
          </div>
        )}

        {/* Chart histórico — independiente del estado online del device.
            Si la llave está offline ahora pero capturamos snapshots
            mientras estaba conectada, los seguimos mostrando. La parte
            del rango sin data queda como franja vacía (eje X fijo). */}
        {rangeSnapshots.length >= 1 && (
          <div className="mt-6 border-t pt-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Potencia · {RANGES[range].label}
            </p>
            <DeviceEnergyChart
              data={rangeSnapshots}
              windowStartMs={rangeStartTs}
              windowEndMs={Date.now()}
            />
          </div>
        )}

        {(todayKwh != null || rangeKwh != null) && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 border-t pt-4">
            <Stat
              label="Consumo hoy"
              value={formatKwh(todayKwh)}
              hint={
                todayKwh != null && unit !== "kwh"
                  ? (formatInUnit(todayKwh * tariff, currency) ?? undefined)
                  : undefined
              }
            />
            <Stat
              label={`Consumo últim${RANGES[range].shortLabel === "24h" ? "as" : "os"} ${RANGES[range].label}`}
              value={formatKwh(rangeKwh)}
              hint={
                rangeKwh != null && unit !== "kwh"
                  ? (formatInUnit(rangeKwh * tariff, currency) ?? undefined)
                  : undefined
              }
            />
          </div>
        )}

        {hasIncompleteHistory && rangeFirstSnapshotIso && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <p className="font-medium">Histórico parcial</p>
              <p className="opacity-80">
                Sólo tenemos datos desde el{" "}
                {format(new Date(rangeFirstSnapshotIso), "d MMM HH:mm", {
                  locale: es,
                })}
                . Las capturas horarias arrancaron hace poco; el rango
                de {RANGES[range].label} se irá llenando.
              </p>
            </div>
          </div>
        )}

        {billComparisons.length > 0 && (
          <BillComparisonsTable comparisons={billComparisons} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Comparativa por device: facturas de luz vs consumo Tuya en el mismo
 * período. (WIK-75 — antes era una columna en /facturas.)
 *
 * Si el snapshot Tuya cubre <70% del período facturado, mostramos un
 * pill gris "parcial XX%" en vez del Δ% para no transmitir un error
 * cuantitativo donde sólo tenemos una muestra parcial.
 *
 * (WIK-80) En mobile renderiza como card-list (cada factura una mini-card
 * con label/value pairs), porque la tabla de 4 columnas hacía scroll
 * horizontal y la columna "Δ" (donde está el badge importante) quedaba
 * oculta sin que se note. En sm+ vuelve a tabla normal.
 */
function BillComparisonsTable({
  comparisons,
}: {
  comparisons: BillComparison[];
}) {
  return (
    <div className="mt-6 border-t pt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Facturado vs Tuya
      </p>

      {/* Mobile: card-list. Cada factura es un bloque label/value visible
          sin scroll horizontal — el badge Δ queda siempre a la vista. */}
      <ul className="flex flex-col gap-3 sm:hidden">
        {comparisons.map((c) => (
          <li
            key={c.bill.id}
            className="rounded-md border bg-muted/30 px-3 py-2 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`whitespace-nowrap text-xs ${
                  c.bill.period_inferred
                    ? "italic text-muted-foreground"
                    : "text-muted-foreground"
                }`}
                title={
                  c.bill.period_inferred
                    ? "Período inferido a partir del vencimiento de la factura anterior."
                    : undefined
                }
              >
                {c.bill.period_inferred ? "≈ " : ""}
                {formatBillPeriod(
                  c.bill.effective_period_from,
                  c.bill.effective_period_to,
                )}
              </span>
              <DeltaBadge
                tuyaKwh={c.tuyaKwh}
                deltaPct={c.deltaPct}
                level={c.level}
                coverageFraction={c.coverageFraction}
              />
            </div>
            <div className="mt-1 flex justify-between gap-4 text-xs">
              <span>
                <span className="text-muted-foreground">Facturado: </span>
                <span className="tabular-nums">
                  {c.bill.kwh_billed!.toLocaleString("es-UY")} kWh
                </span>
              </span>
              <span>
                <span className="text-muted-foreground">Tuya: </span>
                <span className="tabular-nums">
                  {c.tuyaKwh.toLocaleString("es-UY", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  kWh
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop: tabla normal (sm+). */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1 font-medium">Período</th>
              <th className="pb-1 text-right font-medium">Facturado</th>
              <th className="pb-1 text-right font-medium">Tuya</th>
              <th className="pb-1 text-right font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((c) => (
              <tr key={c.bill.id} className="border-t">
                <td
                  className={`py-1.5 pr-2 whitespace-nowrap ${
                    c.bill.period_inferred
                      ? "italic text-muted-foreground"
                      : ""
                  }`}
                  title={
                    c.bill.period_inferred
                      ? "Período inferido a partir del vencimiento de la factura anterior."
                      : undefined
                  }
                >
                  {c.bill.period_inferred ? "≈ " : ""}
                  {formatBillPeriod(
                    c.bill.effective_period_from,
                    c.bill.effective_period_to,
                  )}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                  {c.bill.kwh_billed!.toLocaleString("es-UY")} kWh
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                  {c.tuyaKwh.toLocaleString("es-UY", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  kWh
                </td>
                <td className="whitespace-nowrap py-1.5 text-right">
                  <DeltaBadge
                    tuyaKwh={c.tuyaKwh}
                    deltaPct={c.deltaPct}
                    level={c.level}
                    coverageFraction={c.coverageFraction}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatBillPeriod(from: string | null, to: string | null): string {
  if (!from && !to) return "—";
  if (from && to) {
    const f = format(parseISO(from), "d MMM", { locale: es });
    const t = format(parseISO(to), "d MMM yy", { locale: es });
    return `${f} → ${t}`;
  }
  const single = (from ?? to) as string;
  return format(parseISO(single), "MMM yyyy", { locale: es });
}
