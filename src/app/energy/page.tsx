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
  formatMoney,
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
  formatUsd,
  getRatesToUsd,
  toUsd,
  type FxRate,
} from "@/lib/fx";
import { createClient } from "@/lib/supabase/server";
import type { Property } from "@/lib/types";

export const dynamic = "force-dynamic";

type PropertySummary = Pick<
  Property,
  "id" | "name" | "currency" | "tariff_per_kwh"
>;

type DeviceWithContext = {
  device: TuyaDevice;
  homeName: string | null;
  property: PropertySummary | null;
  reading: EnergyReading | null;
  readError: string | null;
  /** Effective tariff used for cost calc (property override or default). */
  tariff: number;
  /** ISO 4217 currency for display. */
  currency: string;
};

function formatPower(w: number | null): string {
  if (w == null) return "—";
  if (w < 1000) return `${w.toFixed(0)} W`;
  return `${(w / 1000).toFixed(2)} kW`;
}

function formatNumber(n: number | null, unit: string, digits = 1): string {
  if (n == null) return "—";
  return `${n.toFixed(digits)} ${unit}`;
}

export default async function EnergyPage() {
  const defaultTariff = getDefaultTariff();

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
      return {
        device,
        homeName: homeNameByDeviceId.get(device.id) ?? null,
        property,
        reading,
        readError,
        tariff,
        currency,
      };
    }),
  );

  // Aggregate totals — split by currency since we can't sum across them.
  const totalsByCurrency = new Map<
    string,
    { power: number; energy: number; tariffSum: number; tariffCount: number }
  >();
  for (const ctx of devicesWithContext) {
    const curr = totalsByCurrency.get(ctx.currency) ?? {
      power: 0,
      energy: 0,
      tariffSum: 0,
      tariffCount: 0,
    };
    if (ctx.reading?.power_w != null) curr.power += ctx.reading.power_w;
    if (ctx.reading?.total_energy_kwh != null)
      curr.energy += ctx.reading.total_energy_kwh;
    curr.tariffSum += ctx.tariff;
    curr.tariffCount += 1;
    totalsByCurrency.set(ctx.currency, curr);
  }

  // Fetch USD exchange rates for all distinct currencies in parallel.
  const fxRates = await getRatesToUsd(totalsByCurrency.keys());

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
              <code>znyk</code> o nombre que contenga "Circuit breaker" /
              "breaker" / "Térmica".
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {Array.from(totalsByCurrency.entries()).map(([currency, t]) => {
            const avgTariff = t.tariffSum / Math.max(1, t.tariffCount);
            const cost = estimateCost(
              {
                power_w: t.power || null,
                voltage_v: null,
                current_a: null,
                total_energy_kwh: t.energy || null,
              },
              avgTariff,
              currency,
            );
            const fx = fxRates.get(currency);
            return (
              <Card key={currency}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="h-5 w-5" />
                    Total · {currency}
                  </CardTitle>
                  <CardDescription>
                    Devices con tarifa en {currency} (≈ {avgTariff.toFixed(2)}{" "}
                    {currency}/kWh).
                    {fx && (
                      <>
                        {" "}
                        Cambio: 1 USD ≈ {fx.per_usd.toLocaleString("es-UY", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        {currency} ({fx.source}).
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <Stat
                      label="Potencia ahora"
                      value={formatPower(t.power || null)}
                    />
                    <MoneyStat
                      label="Costo / hora"
                      amount={cost.hourly_cost_at_current}
                      currency={currency}
                      fx={fx}
                    />
                    <MoneyStat
                      label="Proyección 24 h"
                      amount={cost.daily_cost_at_current}
                      currency={currency}
                      fx={fx}
                      footHint="al consumo actual"
                    />
                    <Stat
                      label="Acumulado total"
                      value={
                        t.energy ? `${t.energy.toFixed(1)} kWh` : "—"
                      }
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
                </CardContent>
              </Card>
            );
          })}

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

function MoneyStat({
  label,
  amount,
  currency,
  fx,
  footHint,
}: {
  label: string;
  amount: number | null;
  currency: string;
  fx: FxRate | undefined;
  footHint?: string;
}) {
  const usdAmount = toUsd(amount, fx);
  return (
    <Stat
      label={label}
      value={formatMoney(amount, currency)}
      hint={
        usdAmount != null ? (
          <>
            ≈ {formatUsd(usdAmount)}
            {footHint && <span className="block">{footHint}</span>}
          </>
        ) : (
          footHint
        )
      }
    />
  );
}

function FxFooter({ rates }: { rates: Map<string, FxRate> }) {
  if (rates.size === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Tasas de cambio:{" "}
      {Array.from(rates.values())
        .filter((r) => r.currency !== "USD")
        .map(
          (r) =>
            `1 USD ≈ ${r.per_usd.toLocaleString("es-UY", {
              maximumFractionDigits: 2,
            })} ${r.currency}`,
        )
        .join(" · ")}
      {" — "}
      <em>
        {Array.from(new Set(Array.from(rates.values(), (r) => r.source))).join(
          ", ",
        )}
      </em>
    </p>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Energía</h1>
      <p className="text-sm text-muted-foreground">
        Consumo en vivo por propiedad. La tarifa y moneda se configuran por
        propiedad en{" "}
        <a
          href="/admin/properties"
          className="underline hover:text-foreground"
        >
          /admin/properties
        </a>
        .
      </p>
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

function DeviceEnergyCard({
  ctx,
  fx,
}: {
  ctx: DeviceWithContext;
  fx: FxRate | undefined;
}) {
  const { device, homeName, property, reading, readError, tariff, currency } =
    ctx;
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
              {tariff.toFixed(2)} {currency}/kWh
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
                  ? `${formatNumber(reading.voltage_v, "V", 0)} · ${formatNumber(reading.current_a, "A", 1)}`
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
              value={
                reading.total_energy_kwh != null
                  ? `${reading.total_energy_kwh.toFixed(1)} kWh`
                  : "—"
              }
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
      </CardContent>
    </Card>
  );
}
