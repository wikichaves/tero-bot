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
import {
  formatRate,
  formatUsd,
  getRatesToUsd,
  toUsd,
  type FxRate,
} from "@/lib/fx";
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
  /** Facturas de luz con período + kWh facturado para la propiedad del
   *  device, comparadas contra el consumo Tuya en el mismo período. (WIK-75) */
  billComparisons: BillComparison[];
};

export default async function EnergyPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const defaultTariff = getDefaultTariff();
  const sp = await searchParams;
  const range: RangeKey =
    sp.range === "7d" || sp.range === "30d" ? sp.range : "24h";
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
        <Header range={range} />
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

  // Fetch USD exchange rates for all distinct currencies in parallel.
  const distinctCurrencies = new Set(
    devicesWithContext.map((d) => d.currency),
  );
  const fxRates = await getRatesToUsd(distinctCurrencies);

  return (
    <div className="flex flex-col gap-6">
      <Header range={range} />

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
              range={range}
            />
          ))}

          <FxFooter rates={fxRates} />
        </>
      )}
    </div>
  );
}

function Header({ range }: { range: RangeKey }) {
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
          <Link key={r} href={r === "24h" ? "/energy" : `/energy?range=${r}`}>
            <Button
              variant={range === r ? "default" : "outline"}
              size="sm"
            >
              {RANGES[r].label}
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
  range,
}: {
  ctx: DeviceWithContext;
  fx: FxRate | undefined;
  range: RangeKey;
}) {
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
    billComparisons,
  } = ctx;

  // Histórico parcial: si el primer snapshot dentro del rango es de >12h
  // *después* del inicio teórico del rango, mostramos un banner. Útil
  // ahora que el cron horario arrancó hace poco y las ventanas de 7d/30d
  // todavía no tienen data completa.
  const rangeStartTs = Date.now() - RANGES[range].hours * 60 * 60 * 1000;
  const HISTORICAL_GAP_THRESHOLD_MS = 12 * 60 * 60 * 1000;
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

  function moneyHint(amount: number | null, suffix?: string) {
    const usd = toUsd(amount, fx);
    if (usd == null) return suffix;
    return (
      <>
        ≈ {formatUsd(usd)}
        {suffix && <span className="block">{suffix}</span>}
      </>
    );
  }

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
        {readError ? (
          <p className="text-sm text-destructive">
            No se pudo leer el estado: {readError}
          </p>
        ) : !device.online ? (
          <p className="text-sm text-muted-foreground">
            El device está offline — los valores en vivo no están disponibles.
          </p>
        ) : !reading ||
          (reading.power_w == null && reading.total_energy_kwh == null) ? (
          <p className="text-sm text-muted-foreground">
            Tuya no devolvió datos de potencia/energía para este device.
          </p>
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
              label="Costo / hora"
              value={formatMoney(cost.hourly_cost_at_current, currency)}
              hint={moneyHint(cost.hourly_cost_at_current)}
            />
            <Stat
              label="Proyección 24 h"
              value={formatMoney(cost.daily_cost_at_current, currency)}
              hint={moneyHint(
                cost.daily_cost_at_current,
                "si se mantiene este consumo",
              )}
            />
            <Stat
              label="Acumulado total"
              value={formatKwh(reading.total_energy_kwh)}
              hint={
                <>
                  {formatMoney(cost.total_cost, currency)}
                  {fx && cost.total_cost != null && (
                    <span className="block opacity-70">
                      ≈ {formatUsd(toUsd(cost.total_cost, fx))}
                    </span>
                  )}
                </>
              }
            />
          </div>
        )}

        {(todayKwh != null || rangeKwh != null) && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 border-t pt-4">
            <Stat
              label="Consumo hoy"
              value={formatKwh(todayKwh)}
              hint={
                todayKwh != null
                  ? (() => {
                      const localCost = todayKwh * tariff;
                      return (
                        <>
                          {formatMoney(localCost, currency)}
                          {fx && (
                            <span className="block opacity-70">
                              ≈ {formatUsd(toUsd(localCost, fx))}
                            </span>
                          )}
                        </>
                      );
                    })()
                  : undefined
              }
            />
            <Stat
              label={`Consumo últim${RANGES[range].shortLabel === "24h" ? "as" : "os"} ${RANGES[range].label}`}
              value={formatKwh(rangeKwh)}
              hint={
                rangeKwh != null
                  ? (() => {
                      const localCost = rangeKwh * tariff;
                      return (
                        <>
                          {formatMoney(localCost, currency)}
                          {fx && (
                            <span className="block opacity-70">
                              ≈ {formatUsd(toUsd(localCost, fx))}
                            </span>
                          )}
                        </>
                      );
                    })()
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
