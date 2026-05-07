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
  formatUyu,
  getDeviceStatus,
  getEnergyTariff,
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
import { createClient } from "@/lib/supabase/server";
import type { Property } from "@/lib/types";

export const dynamic = "force-dynamic";

type DeviceWithContext = {
  device: TuyaDevice;
  homeName: string | null;
  propertyName: string | null;
  reading: EnergyReading | null;
  readError: string | null;
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
  const tariff = getEnergyTariff();

  // Fetch the rich flat device list (iot-03, includes category_name) AND
  // the home grouping (for home name mapping). They use different endpoints
  // and return slightly different shapes — we merge them here.
  const [flatRes, groupedRes] = await Promise.all([
    listAllDevices().catch((err: Error) => ({ error: err.message })),
    listDevicesGroupedByHome().catch((err: Error) => ({ error: err.message })),
  ]);

  if ("error" in flatRes) {
    return (
      <div className="flex flex-col gap-6">
        <Header tariff={tariff} />
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            No se pudo hablar con Tuya: {flatRes.error}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Build deviceId → homeName map from the grouped response (or empty if
  // that call failed — we can still show energy without home grouping).
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
    supabase.from("properties").select("id, name"),
    listPropertyDeviceMap(),
  ]);
  const properties = (propertiesRes.data ?? []) as Pick<
    Property,
    "id" | "name"
  >[];
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  const devicesWithContext: DeviceWithContext[] = await Promise.all(
    energyDevices.map(async (device) => {
      const assignment = deviceMap.get(device.id);
      const propertyName = assignment
        ? (propertyById.get(assignment.property_id)?.name ?? null)
        : null;
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
        propertyName,
        reading,
        readError,
      };
    }),
  );

  // Aggregate totals across all devices.
  const totals = devicesWithContext.reduce(
    (acc, { reading }) => {
      if (reading?.power_w != null) acc.power += reading.power_w;
      if (reading?.total_energy_kwh != null)
        acc.energy += reading.total_energy_kwh;
      return acc;
    },
    { power: 0, energy: 0 },
  );
  const aggregateCost = estimateCost({
    power_w: totals.power || null,
    voltage_v: null,
    current_a: null,
    total_energy_kwh: totals.energy || null,
  });

  return (
    <div className="flex flex-col gap-6">
      <Header tariff={tariff} />

      {devicesWithContext.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground space-y-2">
            <p>
              No se encontraron dispositivos identificables como medidores
              de consumo entre los {flatRes.devices.length} devices del cloud
              project.
            </p>
            <p>
              Buscamos por categoría <code>pc</code> o nombre que contenga
              "Circuit breaker" / "breaker". Si las Térmicas tienen otra
              categoría en tu setup, agregame el detalle (categoría exacta
              que ves en <em>/admin/tuya</em>) y ajusto el filtro.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Total agregado
              </CardTitle>
              <CardDescription>
                Suma de los {devicesWithContext.length} medidores de
                consumo activos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-4">
                <Stat
                  label="Potencia ahora"
                  value={formatPower(totals.power || null)}
                />
                <Stat
                  label="Costo / hora"
                  value={formatUyu(aggregateCost.hourly_cost_at_current_uyu)}
                />
                <Stat
                  label="Proyección 24 h"
                  value={formatUyu(aggregateCost.daily_cost_at_current_uyu)}
                  hint="al consumo actual"
                />
                <Stat
                  label="Acumulado total"
                  value={
                    totals.energy
                      ? `${totals.energy.toFixed(1)} kWh`
                      : "—"
                  }
                  hint={formatUyu(aggregateCost.total_cost_uyu)}
                />
              </div>
            </CardContent>
          </Card>

          {devicesWithContext.map((d) => (
            <DeviceEnergyCard key={d.device.id} ctx={d} />
          ))}
        </>
      )}
    </div>
  );
}

function Header({ tariff }: { tariff: number }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Energía</h1>
        <p className="text-sm text-muted-foreground">
          Consumo en vivo y costo estimado al tarifa actual.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Tarifa configurada:{" "}
        <span className="font-mono">{tariff} UYU/kWh</span>
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
  hint?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function DeviceEnergyCard({ ctx }: { ctx: DeviceWithContext }) {
  const { device, homeName, propertyName, reading, readError } = ctx;
  const cost = reading
    ? estimateCost(reading)
    : {
        total_cost_uyu: null,
        daily_cost_at_current_uyu: null,
        hourly_cost_at_current_uyu: null,
        tariff_uyu_per_kwh: getEnergyTariff(),
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
              {homeName && propertyName && " · "}
              {propertyName && (
                <>
                  Propiedad: <strong>{propertyName}</strong>
                </>
              )}
              {!homeName && !propertyName && (
                <span className="text-muted-foreground">Sin asignar</span>
              )}
            </CardDescription>
          </div>
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
            Cuando vuelva a conectarse, vamos a poder leer el consumo.
          </p>
        ) : !reading ||
          (reading.power_w == null && reading.total_energy_kwh == null) ? (
          <p className="text-sm text-muted-foreground">
            Tuya no devolvió datos de potencia/energía para este device.
            Puede ser un modelo sin métrica de consumo.
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
              value={formatUyu(cost.hourly_cost_at_current_uyu)}
              hint="al consumo actual"
            />
            <Stat
              label="Proyección 24 h"
              value={formatUyu(cost.daily_cost_at_current_uyu)}
              hint="si se mantiene este consumo"
            />
            <Stat
              label="Acumulado total"
              value={
                reading.total_energy_kwh != null
                  ? `${reading.total_energy_kwh.toFixed(1)} kWh`
                  : "—"
              }
              hint={formatUyu(cost.total_cost_uyu)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
