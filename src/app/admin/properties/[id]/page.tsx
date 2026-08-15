import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Property } from "@/lib/types";
import { FloorPlanSvg, type FloorPin } from "./floor-plan-svg";

/**
 * /admin/properties/[id] — detalle de una property.
 *
 * Por ahora muestra el plano de la casa (floor plan) con los devices
 * posicionados encima y su última lectura de temperatura/humedad en vivo.
 * A futuro esta página aloja consumo, reservas, etc.
 */

export const dynamic = "force-dynamic";

const SENSOR_KINDS = new Set(["sensor"]);

type DeviceRow = {
  id: string;
  tuya_device_name: string | null;
  device_kind: string;
  pin_x: number | null;
  pin_y: number | null;
};

type SnapRow = {
  property_device_id: string;
  temperature_c: number | null;
  humidity_pct: number | null;
  taken_at: string;
};

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const allowedIds = await getAllowedPropertyIds(profile);
  if (allowedIds !== null && !allowedIds.includes(id)) notFound();

  const supabase = await createClient();
  const { data: propData } = await supabase
    .from("properties")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const property = propData as Property | null;
  if (!property) notFound();

  const { data: devData } = await supabase
    .from("property_devices")
    .select("id, tuya_device_name, device_kind, pin_x, pin_y")
    .eq("property_id", id);
  const devices = (devData ?? []) as DeviceRow[];

  // Última lectura por device (para los sensores del plano).
  const sensorIds = devices
    .filter((d) => SENSOR_KINDS.has(d.device_kind))
    .map((d) => d.id);
  const snapByDevice = new Map<string, SnapRow>();
  if (sensorIds.length > 0) {
    const { data: snaps } = await supabase
      .from("sensor_snapshots")
      .select("property_device_id, temperature_c, humidity_pct, taken_at")
      .in("property_device_id", sensorIds)
      .order("taken_at", { ascending: false })
      .limit(2000);
    for (const s of (snaps ?? []) as SnapRow[]) {
      if (!snapByDevice.has(s.property_device_id))
        snapByDevice.set(s.property_device_id, s);
    }
  }

  const pins: FloorPin[] = devices
    .filter((d) => d.pin_x !== null && d.pin_y !== null)
    .map((d) => {
      const isSensor = SENSOR_KINDS.has(d.device_kind);
      const snap = snapByDevice.get(d.id);
      return {
        id: d.id,
        name: d.tuya_device_name ?? "Device",
        x: d.pin_x as number,
        y: d.pin_y as number,
        isSensor,
        tempC: isSensor ? snap?.temperature_c ?? null : null,
        humidityPct: isSensor ? snap?.humidity_pct ?? null : null,
      };
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/properties"
          aria-label="Volver"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-4xl">{property.name}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plano de la casa</CardTitle>
          <CardDescription>
            Temperatura y humedad en vivo por ambiente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FloorPlanSvg pins={pins} />
        </CardContent>
      </Card>
    </div>
  );
}
