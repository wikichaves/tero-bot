"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { snapshotAllDevices } from "@/lib/tuya/snapshots";
import { backfillAllDevices } from "@/lib/tuya/backfill";

/**
 * Triggers the snapshot routine on demand from the UI. Same logic as the
 * hourly cron — useful to populate data immediately after assigning a
 * device or to verify everything is wired correctly.
 *
 * WIK-167: restringido a admin. Antes admin+gestor, pero el button que
 * dispara esta action ahora solo se renderiza para admin, y un gestor
 * disparando snapshots arbitrarios no es algo que necesitemos habilitar.
 */
export async function snapshotNow() {
  await requireRole(["admin"]);
  try {
    const result = await snapshotAllDevices();
    revalidatePath("/energy");
    return { ok: true, result };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * One-shot historical backfill: pulls daily kWh history from Tuya's
 * Statistics API and seeds `energy_snapshots` with synthetic midnight-UTC
 * rows so historical `utility_bills` can be compared. Safe to re-run
 * (duplicate days are skipped via the unique hourly index).
 */
export async function backfillSnapshots(months: number = 12) {
  await requireRole(["admin"]);
  try {
    const results = await backfillAllDevices(months);
    revalidatePath("/energy");
    revalidatePath("/bills");
    return {
      ok: true,
      summary: {
        devicesProcessed: results.length,
        inserted: results.reduce((s, r) => s + r.inserted, 0),
        skipped_duplicate: results.reduce(
          (s, r) => s + r.skipped_duplicate,
          0,
        ),
        errors: results.filter((r) => r.error).length,
      },
      results,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
