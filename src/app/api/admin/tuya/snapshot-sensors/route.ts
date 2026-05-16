import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { snapshotAllSensors } from "@/lib/sensors/snapshots";

/**
 * Admin trigger manual del snapshot de sensores (WIK-82). Igual que el cron
 * `/api/cron/sensor-snapshot` pero con auth de sesión admin en lugar de
 * Bearer CRON_SECRET — útil para forzar captura inmediata sin esperar al
 * cron diario, especialmente mientras estamos validando la integración
 * con el cloud.
 *
 * POST /api/admin/tuya/snapshot-sensors  (admin sesión)
 *
 * Returns: { ranAt, results: [{ tuya_device_id, ok, inserted, reading }] }
 */
export async function POST() {
  await requireRole(["admin"]);
  try {
    const result = await snapshotAllSensors();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
