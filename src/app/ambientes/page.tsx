import Link from "next/link";
import { AlertTriangle, Droplet, Thermometer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { maybeSnapshotSensorsIfStale } from "@/lib/sensors/snapshots";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Property, Room } from "@/lib/types";
import { SnapshotSensorsButton } from "@/app/admin/tuya/snapshot-sensors-button";
import { RoomMiniChart } from "./room-mini-chart";
import { RoomSortControls } from "./room-sort-controls";

/**
 * /ambientes — vista por room/ambiente con la última lectura de cada
 * sensor + mini-gráfico de las últimas 24h.
 *
 * Datasource: `sensor_snapshots` filtrados por sensores asignados a un
 * room. Si un sensor no tiene room asignado, cae en una card "Sin ambiente"
 * por property como catch-all.
 *
 * Si la última captura tiene >60 min, dispara un snapshot fresco antes
 * de renderizar — compensa la limitación de Vercel Hobby (cron diario).
 */

export const dynamic = "force-dynamic";

type Snapshot = {
  property_device_id: string;
  taken_at: string;
  temperature_c: number | null;
  humidity_pct: number | null;
  battery_pct: number | null;
};

type Device = {
  id: string;
  property_id: string;
  tuya_device_name: string | null;
  room_id: string | null;
};

// WIK-98: rango configurable por ?range=. Default 24h.
const RANGES = {
  "24h": { hours: 24, label: "24 horas" },
  "7d": { hours: 7 * 24, label: "7 días" },
  "30d": { hours: 30 * 24, label: "30 días" },
} as const;

type RangeKey = keyof typeof RANGES;

export default async function AmbientesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  // requireRole se hace en el layout — pero necesitamos el profile
  // para aplicar scope por property (WIK-94).
  const profile = await requireProfile();
  const allowedIds = await getAllowedPropertyIds(profile);
  // Best-effort: si la última lectura está vieja, dispara captura nueva.
  await maybeSnapshotSensorsIfStale(60).catch(() => null);

  const sp = await searchParams;
  const range: RangeKey =
    sp.range === "7d" || sp.range === "30d" ? sp.range : "24h";

  const supabase = await createClient();
  const since = new Date(
    Date.now() - RANGES[range].hours * 60 * 60 * 1000,
  ).toISOString();

  let propsQuery = supabase
    .from("properties")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (allowedIds !== null) propsQuery = propsQuery.in("id", allowedIds);

  let roomsQuery = supabase
    .from("rooms")
    .select("id, property_id, name, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (allowedIds !== null) roomsQuery = roomsQuery.in("property_id", allowedIds);

  let devicesQuery = supabase
    .from("property_devices")
    .select("id, property_id, tuya_device_name, room_id")
    .eq("device_kind", "sensor");
  if (allowedIds !== null) devicesQuery = devicesQuery.in("property_id", allowedIds);

  // snapshots no se filtran por property — se filtran indirectamente
  // por property_device_id en el render (solo se muestran los devices
  // que pasaron el scope arriba).
  // Limit explícito (WIK-98): el default de Supabase es 1000, que se
  // queda corto cuando seleccionan 30d con varios sensores.
  const snapshotsQuery = supabase
    .from("sensor_snapshots")
    .select("property_device_id, taken_at, temperature_c, humidity_pct, battery_pct")
    .gte("taken_at", since)
    .order("taken_at", { ascending: true })
    .limit(100_000);

  const [propsRes, roomsRes, devicesRes, snapshotsRes] = await Promise.all([
    propsQuery,
    roomsQuery,
    devicesQuery,
    snapshotsQuery,
  ]);

  const properties = (propsRes.data ?? []) as Pick<
    Property,
    "id" | "name" | "sort_order"
  >[];
  const rooms = (roomsRes.data ?? []) as Pick<
    Room,
    "id" | "property_id" | "name" | "sort_order"
  >[];
  const devices = (devicesRes.data ?? []) as Device[];
  const snapshots = (snapshotsRes.data ?? []) as Snapshot[];

  // Indexes for fast joining downstream.
  const devicesByRoom = new Map<string | null, Device[]>();
  for (const d of devices) {
    const key = d.room_id ?? `__no_room_${d.property_id}`;
    const list = devicesByRoom.get(key) ?? [];
    list.push(d);
    devicesByRoom.set(key, list);
  }
  const snapshotsByDevice = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const list = snapshotsByDevice.get(s.property_device_id) ?? [];
    list.push(s);
    snapshotsByDevice.set(s.property_device_id, list);
  }

  // Properties que tienen al menos un sensor → mostrar
  const propertiesWithSensors = properties.filter((p) =>
    devices.some((d) => d.property_id === p.id),
  );

  if (propertiesWithSensors.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Header range={range} />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground space-y-2">
            <p>
              No hay sensores T/H asignados a ninguna propiedad todavía.
              Para empezar:
            </p>
            <ol className="ml-5 list-decimal space-y-1">
              <li>
                Ir a <Link href="/admin/tuya" className="underline">/admin/tuya</Link>{" "}
                y asignar los devices Tuya marcándolos con tipo &ldquo;Sensor T/H&rdquo;.
              </li>
              <li>
                Apretar &ldquo;Sincronizar ambientes&rdquo; para crear los rooms desde Smart Life.
              </li>
              <li>
                Apretar &ldquo;Capturar sensores&rdquo; para forzar la primera lectura.
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Determinar si el user puede reordenar (admin/gestor).
  const canReorder = profile.role === "admin" || profile.role === "gestor";

  return (
    <div className="flex flex-col gap-6">
      <Header range={range} />
      {propertiesWithSensors.map((property) => {
        const propRooms = rooms.filter((r) => r.property_id === property.id);
        const noRoomKey = `__no_room_${property.id}`;
        const hasOrphans = (devicesByRoom.get(noRoomKey)?.length ?? 0) > 0;
        if (propRooms.length === 0 && !hasOrphans) return null;
        // Sólo cuento como "reorderable" los rooms que aparecen en el grid
        // (los que tienen devices). El "Sin ambiente" no se mueve.
        const visibleRooms = propRooms.filter(
          (r) => (devicesByRoom.get(r.id)?.length ?? 0) > 0,
        );
        return (
          <section key={property.id} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{property.name}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleRooms.map((room, idx) => {
                const roomDevices = devicesByRoom.get(room.id) ?? [];
                return (
                  <RoomCard
                    key={room.id}
                    roomId={room.id}
                    roomName={room.name}
                    devices={roomDevices}
                    snapshotsByDevice={snapshotsByDevice}
                    range={range}
                    canReorder={canReorder}
                    isFirst={idx === 0}
                    isLast={idx === visibleRooms.length - 1}
                  />
                );
              })}
              {hasOrphans && (
                <RoomCard
                  key={noRoomKey}
                  roomId={null}
                  roomName="Sin ambiente"
                  devices={devicesByRoom.get(noRoomKey) ?? []}
                  snapshotsByDevice={snapshotsByDevice}
                  range={range}
                  canReorder={false}
                  isFirst={false}
                  isLast={false}
                />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Header({ range }: { range: RangeKey }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold">Ambientes</h1>
          <p className="text-sm text-muted-foreground">
            Temperatura y humedad en vivo por ambiente. Captura horaria
            desde Tuya. Tocá una card para ver el histórico.
          </p>
        </div>
        <SnapshotSensorsButton />
      </div>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(RANGES) as RangeKey[]).map((r) => (
          <Link key={r} href={r === "24h" ? "/ambientes" : `/ambientes?range=${r}`}>
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

function RoomCard({
  roomId,
  roomName,
  devices,
  snapshotsByDevice,
  range,
  canReorder,
  isFirst,
  isLast,
}: {
  roomId: string | null;
  roomName: string;
  devices: Device[];
  snapshotsByDevice: Map<string, Snapshot[]>;
  range: RangeKey;
  canReorder: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  // Tomamos la lectura más reciente entre todos los sensores del room.
  // Si hay varios, promediamos (típicamente un room tiene 1, pero el
  // schema lo soporta).
  const latestByDevice = devices
    .map((d) => {
      const series = snapshotsByDevice.get(d.id) ?? [];
      const last = series[series.length - 1] ?? null;
      return { device: d, last, series };
    })
    .filter((x) => x.last != null);

  const temps = latestByDevice
    .map((x) => x.last!.temperature_c)
    .filter((v): v is number => v != null);
  const hums = latestByDevice
    .map((x) => x.last!.humidity_pct)
    .filter((v): v is number => v != null);
  const avgT =
    temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const avgH =
    hums.length > 0 ? hums.reduce((a, b) => a + b, 0) / hums.length : null;
  const lastTs = latestByDevice
    .map((x) => x.last!.taken_at)
    .sort()
    .pop();

  // Para el mini-chart usamos el primer device del room (suficiente para
  // hint visual; el detalle tendrá selector por device si hay varios).
  const chartSeries = latestByDevice[0]?.series ?? [];

  // Cuando el room tiene devices pero no hay snapshots en la ventana de
  // tiempo seleccionada, mostramos un warning en lugar de los valores.
  // Esto cubre:
  //   - Sensores recién agregados que aún no se capturaron
  //   - Sensores con problemas (offline, sin batería, firmware que no
  //     responde al endpoint /status — ver WIK-87 "Jugacion Temp")
  const hasNoRecentReadings = latestByDevice.length === 0;
  const rangeLabel = RANGES[range].label;

  const inner = (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>{roomName}</span>
          <Badge variant="secondary" className="text-[10px] font-normal">
            {devices.length} sensor{devices.length === 1 ? "" : "es"}
          </Badge>
        </CardTitle>
        {lastTs && (
          <CardDescription className="text-xs">
            Última lectura: {timeAgo(lastTs)}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {hasNoRecentReadings ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <p className="font-medium">Sin lecturas recientes</p>
              <p className="opacity-80">
                El sensor no respondió en {rangeLabel}. Revisar
                conexión / batería en Smart Life o forzá una captura.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-6">
              <div className="flex items-baseline gap-1.5">
                <Thermometer className="h-4 w-4 self-center text-orange-500" />
                <span className="text-2xl font-semibold tabular-nums">
                  {avgT != null ? avgT.toFixed(1) : "—"}
                </span>
                <span className="text-xs text-muted-foreground">°C</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <Droplet className="h-4 w-4 self-center text-blue-500" />
                <span className="text-2xl font-semibold tabular-nums">
                  {avgH != null ? avgH.toFixed(0) : "—"}
                </span>
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
            {chartSeries.length >= 2 && (
              <RoomMiniChart series={chartSeries} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );

  // Layout:
  //   - Si hay roomId, la card es un Link al detalle (heredando el ?range=)
  //   - Si el user puede reordenar, los chevrons van *fuera* del Link
  //     para que el click no navegue. Posicionados absolute arriba-derecha.
  const detailHref =
    range === "24h" ? `/ambientes/${roomId}` : `/ambientes/${roomId}?range=${range}`;

  if (roomId) {
    return (
      <div className="relative">
        <Link href={detailHref} className="block">
          {inner}
        </Link>
        {canReorder && (
          <div className="absolute right-1 top-1 z-10">
            <RoomSortControls
              roomId={roomId}
              isFirst={isFirst}
              isLast={isLast}
            />
          </div>
        )}
      </div>
    );
  }
  return inner;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min}min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  const d = Math.round(hr / 24);
  return `hace ${d}d`;
}
