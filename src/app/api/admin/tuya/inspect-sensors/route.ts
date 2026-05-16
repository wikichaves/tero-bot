import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { tuyaFetch } from "@/lib/tuya/client";
import { getDeviceStatus } from "@/lib/tuya/energy";
import {
  listDevicesGroupedByHome,
  type TuyaDevice,
} from "@/lib/tuya/devices";

/**
 * Admin diagnostic temporal (WIK-NN sensors feature): lista todos los devices
 * agrupados por home y por cada uno reporta category + DPs disponibles. Saca
 * un snapshot del estado actual del cloud para poder diseñar el feature de
 * sensores T/H sabiendo exactamente qué hay.
 *
 * Borrar este endpoint cuando el feature de sensors esté en producción —
 * para esa altura tendremos UIs propias que muestran esta info.
 */
export async function GET() {
  await requireRole(["admin"]);
  const grouped = await listDevicesGroupedByHome();
  const out: Array<{
    home: string;
    home_id: string | number;
    rooms: unknown;
    devices: Array<{
      id: string;
      name: string;
      category?: string;
      category_name?: string;
      product_name?: string;
      online: boolean;
      dps?: string[];
      dp_sample?: unknown[];
      error?: string;
    }>;
  }> = [];

  for (const { home, devices } of grouped.homes) {
    // Intentar pullar las rooms del home — endpoint Tuya estándar.
    let rooms: unknown = null;
    try {
      rooms = await tuyaFetch<unknown>(
        "GET",
        `/v1.0/homes/${home.home_id}/rooms`,
      );
    } catch (e) {
      rooms = { error: (e as Error).message };
    }

    const detailed = await Promise.all(
      devices.map(async (d: TuyaDevice) => {
        try {
          const status = await getDeviceStatus(d.id);
          return {
            id: d.id,
            name: d.name,
            category: d.category,
            category_name: d.category_name,
            product_name: d.product_name,
            online: d.online,
            dps: status.map((s) => s.code),
            dp_sample: status.slice(0, 12), // first 12 DPs with values
          };
        } catch (e) {
          return {
            id: d.id,
            name: d.name,
            category: d.category,
            category_name: d.category_name,
            online: d.online,
            error: (e as Error).message,
          };
        }
      }),
    );

    out.push({
      home: home.name,
      home_id: home.home_id,
      rooms,
      devices: detailed,
    });
  }

  return NextResponse.json({ ok: true, data: out }, { status: 200 });
}
