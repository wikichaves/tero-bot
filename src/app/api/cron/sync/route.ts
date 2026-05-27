import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAirbnb, type SyncResult } from "@/lib/airbnb/sync";
import { runSyncRooms, type SyncRoomsResult } from "@/lib/tuya/sync-rooms";
import { withCronAlerts } from "@/lib/util/cron-alert";

/**
 * Daily sync (Vercel cron). Hace:
 *   1. Pull de iCal de Airbnb por cada property (reservas)
 *   2. Sync de rooms + device→room mappings desde Tuya Smart Life
 *      (nombres y orden de Tuya pisan los de la DB — WIK-98 v3)
 *
 * Protegido por CRON_SECRET (Bearer automático de Vercel).
 */
export const GET = withCronAlerts("sync", async (request: Request) => {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  // 1. Airbnb iCal sync.
  const admin = createAdminClient();
  const { data: properties, error } = await admin
    .from("properties")
    .select("id, name, airbnb_ical_url")
    .not("airbnb_ical_url", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const airbnbResults: Record<string, SyncResult | { error: string }> = {};
  for (const p of properties ?? []) {
    if (!p.airbnb_ical_url) continue;
    try {
      airbnbResults[p.name] = await syncAirbnb(p.id, p.airbnb_ical_url);
    } catch (e) {
      airbnbResults[p.name] = { error: (e as Error).message };
    }
  }

  // 2. Tuya rooms sync (name + sort_order). Best-effort — un fallo acá
  // no debe romper el sync de Airbnb.
  let tuyaRooms: SyncRoomsResult | { error: string };
  try {
    tuyaRooms = await runSyncRooms();
  } catch (e) {
    tuyaRooms = { error: (e as Error).message };
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    airbnb: airbnbResults,
    tuyaRooms,
  });
});
