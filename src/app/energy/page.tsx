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
import { createClient } from "@/lib/supabase/server";
import type { Property } from "@/lib/types";
import { SnapshotButton } from "./snapshot-button";

export const dynamic = "force-dynamic";

type PropertySummary = Pick<
  Property,
  "id" | "name" | "currency" | "tariff_per_kwh"
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
  const [propertiesRes, deviceMap] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name, currency, tariff_per_kwh"),
    listPropertyDeviceMap(),
  ]);
  const properties = (propertiesRes.data ?? []) as PropertySummary[];
  const propertyById = new Map(properties.map((p) => [p.id, p]));

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
      };
    }),
  );

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
      <SnapshotButton />
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
      </CardContent>
    </Card>
  );
}
