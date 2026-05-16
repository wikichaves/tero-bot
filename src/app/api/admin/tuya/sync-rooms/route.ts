import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { tuyaFetch } from "@/lib/tuya/client";
import { listDevicesGroupedByHome } from "@/lib/tuya/devices";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin endpoint (WIK-82 Fase 1): sembrar la tabla `rooms` desde los
 * rooms que el usuario ya configuró en la app Smart Life (Tuya).
 *
 * El sync funciona así:
 *   1. Para cada Tuya home linkeado al cloud project, pull
 *      `/v1.0/homes/{home_id}/rooms` → lista de rooms con
 *      `{room_id, name, sort}`.
 *   2. Match cada home con una `properties` por nombre exacto
 *      (case-insensitive). Si no match, skippear y reportar — el admin
 *      tiene que renombrar el home en Smart Life para que matchee la
 *      property, o crear las rooms manuales.
 *   3. Por cada room nuevo, upsert a `rooms` con
 *      `(property_id, name)` unique key. `tuya_room_id` guarda el id
 *      original para futuros syncs incrementales.
 *
 * Idempotente — correr varias veces no duplica. Solo INSERTa rows
 * faltantes. NO toca rooms que el admin haya editado a mano (no
 * UPDATE de name).
 *
 * Usage:
 *   POST /api/admin/tuya/sync-rooms
 *
 * Response: { synced: [...], skipped: [...] }
 */
export async function POST() {
  await requireRole(["admin"]);
  const admin = createAdminClient();

  const grouped = await listDevicesGroupedByHome();
  if (!grouped.user) {
    return NextResponse.json(
      { error: "no Tuya app user linked" },
      { status: 400 },
    );
  }

  // Map properties by lowercased name for matching.
  const { data: properties, error: propsErr } = await admin
    .from("properties")
    .select("id, name");
  if (propsErr) {
    return NextResponse.json(
      { error: `properties read failed: ${propsErr.message}` },
      { status: 500 },
    );
  }
  const propByName = new Map(
    (properties ?? []).map((p) => [p.name.toLowerCase().trim(), p.id]),
  );

  const synced: Array<{
    home: string;
    property_id: string;
    inserted: number;
    skipped_existing: number;
  }> = [];
  const skipped: Array<{ home: string; reason: string }> = [];

  for (const { home } of grouped.homes) {
    const propertyId = propByName.get(home.name.toLowerCase().trim());
    if (!propertyId) {
      skipped.push({
        home: home.name,
        reason: "no property with matching name (case-insensitive)",
      });
      continue;
    }

    type TuyaRoom = { room_id: number | string; name: string; sort?: number };
    let rooms: TuyaRoom[] = [];
    try {
      const r = await tuyaFetch<TuyaRoom[] | { rooms?: TuyaRoom[] }>(
        "GET",
        `/v1.0/homes/${home.home_id}/rooms`,
      );
      rooms = Array.isArray(r) ? r : (r?.rooms ?? []);
    } catch (e) {
      skipped.push({
        home: home.name,
        reason: `tuya rooms fetch failed: ${(e as Error).message}`,
      });
      continue;
    }

    if (rooms.length === 0) {
      skipped.push({ home: home.name, reason: "Tuya home has no rooms" });
      continue;
    }

    // Existing rooms for this property — para no romper FK ni duplicar.
    const { data: existing } = await admin
      .from("rooms")
      .select("name, tuya_room_id")
      .eq("property_id", propertyId);
    const existingNames = new Set(
      (existing ?? []).map((r) => r.name.toLowerCase().trim()),
    );

    let inserted = 0;
    let skippedExisting = 0;
    for (const tr of rooms) {
      const trName = String(tr.name ?? "").trim();
      if (!trName) continue;
      if (existingNames.has(trName.toLowerCase())) {
        skippedExisting++;
        continue;
      }
      const { error: insErr } = await admin.from("rooms").insert({
        property_id: propertyId,
        name: trName,
        tuya_room_id: String(tr.room_id),
        sort_order: typeof tr.sort === "number" ? tr.sort : 0,
      });
      if (!insErr) inserted++;
    }

    synced.push({
      home: home.name,
      property_id: propertyId,
      inserted,
      skipped_existing: skippedExisting,
    });
  }

  return NextResponse.json({ ok: true, synced, skipped });
}
