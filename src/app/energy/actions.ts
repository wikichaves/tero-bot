"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { snapshotAllDevices } from "@/lib/tuya/snapshots";

/**
 * Triggers the snapshot routine on demand from the UI. Same logic as the
 * hourly cron — useful to populate data immediately after assigning a
 * device or to verify everything is wired correctly.
 */
export async function snapshotNow() {
  await requireRole(["admin", "gestor"]);
  try {
    const result = await snapshotAllDevices();
    revalidatePath("/energy");
    return { ok: true, result };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
