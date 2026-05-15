import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Zap } from "lucide-react";
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
  /** Consumption over the last 7 days. */
  weekKwh: number | null;
  /** Facturas de luz con período + kWh facturado para la propiedad del
   *  device, comparadas contra el consumo Tuya en el mismo período. (WIK-75) */
  billComparisons: BillComparison[];
};

export default async function EnergyPage() {
  const defaultTariff = getDefaultTariff();

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
        <Header />
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

  const supabase = await createClient();
  const [propertiesRes, deviceMap, billsRes] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name, currency, tariff_per_kwh, sort_order")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    listPropertyDeviceMap(),
    // Solo facturas de luz con kWh facturado — son las únicas que tienen
    // sentido contrastar con el medidor Tuya. Limitamos a las últimas
    // ~12 por property al renderizar (la query no limita porque hay
    // muchas properties; el cap está en el render).
    supabase
      .from("utility_bills")
      .select("*, property:properties(id, name, currency)")
      .eq("utility_type", "luz")
      .not("kwh_billed", "is", null)
      .order("due_date", { ascending: false, nullsFirst: false }),
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
  const sevenDaysAgoIso = startOfDaysAgoIso(7);

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
      let weekKwh: number | null = null;
      if (assignment?.id) {
        const [today, week] = await Promise.all([
          getConsumptionSince(assignment.id, todayIso),
          getConsumptionSince(assignment.id, sevenDaysAgoIso),
        ]);
        todayKwh = today.delta_kwh;
        weekKwh = week.delta_kwh;
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
        weekKwh,
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

  // Aggregate Total in USD across ALL properties / currencies.
  // Each device's local cost gets converted via its own currency's FX rate.
  const aggregate = devicesWithContext.reduce(
    (acc, ctx) => {
      if (ctx.reading?.power_w != null) acc.power_w += ctx.reading.power_w;
      if (ctx.reading?.total_energy_kwh != null) {
        acc.energy_kwh += ctx.reading.total_energy_kwh;
      }
      if (ctx.todayKwh != null) acc.today_kwh += ctx.todayKwh;
      if (ctx.weekKwh != null) acc.week_kwh += ctx.weekKwh;
      const fx = fxRates.get(ctx.currency);
      if (!fx) return acc;
      if (ctx.reading) {
        const cost = estimateCost(ctx.reading, ctx.tariff, ctx.currency);
        const hourlyUsd = toUsd(cost.hourly_cost_at_current, fx);
        const dailyUsd = toUsd(cost.daily_cost_at_current, fx);
        const totalUsd = toUsd(cost.total_cost, fx);
        if (hourlyUsd != null) acc.hourly_usd += hourlyUsd;
        if (dailyUsd != null) acc.daily_usd += dailyUsd;
        if (totalUsd != null) acc.total_usd += totalUsd;
      }
      // Historical costs use the same tariff (we don't track tariff changes
      // over time yet — Phase 3).
      if (ctx.todayKwh != null) {
        const todayUsd = toUsd(ctx.todayKwh * ctx.tariff, fx);
        if (todayUsd != null) acc.today_usd += todayUsd;
      }
      if (ctx.weekKwh != null) {
        const weekUsd = toUsd(ctx.weekKwh * ctx.tariff, fx);
        if (weekUsd != null) acc.week_usd += weekUsd;
      }
      return acc;
    },
    {
      power_w: 0,
      energy_kwh: 0,
      hourly_usd: 0,
      daily_usd: 0,
      total_usd: 0,
      today_kwh: 0,
      today_usd: 0,
      week_kwh: 0,
      week_usd: 0,
    },
  );

  return (
    <div className="flex flex-col gap-6">
      <Header />

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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Total · USD
              </CardTitle>
              <CardDescription>
                Suma de los {devicesWithContext.length} medidores activos,
                convertidos a USD al cambio del día.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-4">
                <Stat
                  label="Potencia ahora"
                  value={formatPower(aggregate.power_w || null)}
                />
                <Stat
                  label="Costo / hora"
                  value={formatUsd(aggregate.hourly_usd || null)}
                />
                <Stat
                  label="Proyección 24 h"
                  value={formatUsd(aggregate.daily_usd || null)}
                  hint="al consumo actual"
                />
                <Stat
                  label="Acumulado total"
                  value={formatKwh(aggregate.energy_kwh || null)}
                  hint={formatUsd(aggregate.total_usd || null)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 border-t pt-4">
                <Stat
                  label="Consumo hoy"
                  value={formatKwh(aggregate.today_kwh || null)}
                  hint={
                    aggregate.today_usd > 0
                      ? formatUsd(aggregate.today_usd)
                      : "necesita 2+ snapshots — apretá 'Snapshot ahora' para empezar"
                  }
                />
                <Stat
                  label="Consumo últimos 7 días"
                  value={formatKwh(aggregate.week_kwh || null)}
                  hint={
                    aggregate.week_usd > 0
                      ? formatUsd(aggregate.week_usd)
                      : undefined
                  }
                />
              </div>
            </CardContent>
          </Card>

          {devicesWithContext.map((d) => (
            <DeviceEnergyCard
              key={d.device.id}
              ctx={d}
              fx={fxRates.get(d.currency)}
            />
          ))}

          <FxFooter rates={fxRates} />
        </>
      )}
    </div>
  );
}

function Header() {
  return (
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
}: {
  ctx: DeviceWithContext;
  fx: FxRate | undefined;
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
    weekKwh,
    billComparisons,
  } = ctx;
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

        {(todayKwh != null || weekKwh != null) && (
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
              label="Consumo últimos 7 días"
              value={formatKwh(weekKwh)}
              hint={
                weekKwh != null
                  ? (() => {
                      const localCost = weekKwh * tariff;
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

        {billComparisons.length > 0 && (
          <BillComparisonsTable comparisons={billComparisons} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Mini-tabla por device: facturas de luz vs consumo Tuya en el mismo
 * período. (WIK-75 — antes era una columna en /facturas.)
 *
 * Si el snapshot Tuya cubre <70% del período facturado, mostramos un
 * pill gris "parcial XX%" en vez del Δ% para no transmitir un error
 * cuantitativo donde sólo tenemos una muestra parcial.
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
      <div className="overflow-x-auto">
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
