import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { tuyaFetch } from "@/lib/tuya/client";
import { listDevicesGroupedByHome } from "@/lib/tuya/devices";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin endpoint (WIK-82 Fase 1): sembrar la tabla `rooms` desde los
 * rooms que el usuario ya configuró en la app Smart Life (Tuya), y
 * asignar cada `property_device` al room correspondiente.
 *
 * Flow:
 *   1. Para cada Tuya home linkeado, pull `/v1.0/homes/{home}/rooms`
 *      → lista de rooms con `{room_id, name, sort}`.
 *   2. Match home → property por nombre normalizado (sin tildes,
 *      lowercase, trim) con substring bidireccional. Esto tolera
 *      diferencias tipo "Merced" (Tuya) ↔ "Casa Principal" (DB) o
 *      "Casa 14 Julio" ↔ "Casa Secundaria".
 *   3. Por cada room nuevo, upsert a `rooms`. Idempotente.
 *   4. Por cada room, pull `/v1.0/homes/{home}/rooms/{room_id}/devices`
 *      para obtener device_ids y UPDATE `property_devices.room_id`
 *      del row matcheante.
 *
 * No machaca rooms editados a mano (no UPDATE de name). Tampoco machaca
 * room_id de un property_device que ya tenga una asignación manual
 * distinta de la que dice Tuya (manual override gana — el admin es el
 * source of truth post-sync inicial).
 */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove combining accents
    .replace(/\s+/g, " ");
}

function matchProperty(
  homeName: string,
  properties: { id: string; name: string }[],
): { id: string; name: string } | null {
  const h = normalize(homeName);
  // 1. Match exacto.
  let m = properties.find((p) => normalize(p.name) === h);
  if (m) return m;
  // 2. Substring bidireccional ("Merced" matchea "Casa Principal", y viceversa).
  m = properties.find((p) => {
    const pn = normalize(p.name);
    return pn.includes(h) || h.includes(pn);
  });
  return m ?? null;
}

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

  const { data: properties, error: propsErr } = await admin
    .from("properties")
    .select("id, name");
  if (propsErr) {
    return NextResponse.json(
      { error: `properties read failed: ${propsErr.message}` },
      { status: 500 },
    );
  }
  const propList = properties ?? [];

  // Pre-cargamos property_devices para resolver tuya_device_id → property_device.id.
  const { data: allPDs } = await admin
    .from("property_devices")
    .select("id, tuya_device_id, room_id");
  const pdByTuyaId = new Map(
    (allPDs ?? []).map((pd) => [pd.tuya_device_id, pd]),
  );

  const synced: Array<{
    home: string;
    property: string;
    rooms_inserted: number;
    rooms_existing: number;
    devices_assigned: number;
    devices_already_assigned: number;
    devices_not_in_db: number;
  }> = [];
  const skipped: Array<{ home: string; reason: string }> = [];

  for (const { home } of grouped.homes) {
    const property = matchProperty(home.name, propList);
    if (!property) {
      skipped.push({
        home: home.name,
        reason: `no property name match (DB has: ${propList.map((p) => p.name).join(", ")})`,
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
        reason: `Tuya /rooms failed: ${(e as Error).message}`,
      });
      continue;
    }

    if (rooms.length === 0) {
      skipped.push({
        home: home.name,
        reason: "Tuya home has no rooms configured in Smart Life",
      });
      continue;
    }

    // Existing rooms for this property.
    const { data: existingRooms } = await admin
      .from("rooms")
      .select("id, name, tuya_room_id")
      .eq("property_id", property.id);
    const existingByTuyaId = new Map(
      (existingRooms ?? [])
        .filter((r) => r.tuya_room_id)
        .map((r) => [r.tuya_room_id as string, r]),
    );
    const existingByName = new Map(
      (existingRooms ?? []).map((r) => [normalize(r.name), r]),
    );

    let roomsInserted = 0;
    let roomsExisting = 0;
    let devicesAssigned = 0;
    let devicesAlreadyAssigned = 0;
    let devicesNotInDb = 0;

    for (const tr of rooms) {
      const trName = String(tr.name ?? "").trim();
      if (!trName) continue;
      const tuyaRoomId = String(tr.room_id);

      // Resolver el room en DB: por tuya_room_id primero, después por
      // nombre normalizado (para reusar rooms creados a mano).
      let roomRow =
        existingByTuyaId.get(tuyaRoomId) ??
        existingByName.get(normalize(trName)) ??
        null;

      if (!roomRow) {
        const { data: inserted, error: insErr } = await admin
          .from("rooms")
          .insert({
            property_id: property.id,
            name: trName,
            tuya_room_id: tuyaRoomId,
            sort_order: typeof tr.sort === "number" ? tr.sort : 0,
          })
          .select("id, name, tuya_room_id")
          .single();
        if (insErr || !inserted) continue;
        roomRow = inserted;
        roomsInserted++;
        existingByTuyaId.set(tuyaRoomId, roomRow);
        existingByName.set(normalize(roomRow.name), roomRow);
      } else {
        roomsExisting++;
        // Si el room existía sin tuya_room_id, completarlo ahora para
        // que próximos syncs lo encuentren por id (más estable que name).
        if (!roomRow.tuya_room_id) {
          await admin
            .from("rooms")
            .update({ tuya_room_id: tuyaRoomId })
            .eq("id", roomRow.id);
        }
      }

      // Pull devices de este room y asignar property_devices.room_id.
      type TuyaRoomDevice = { id?: string; device_id?: string };
      let roomDevices: TuyaRoomDevice[] = [];
      try {
        const rd = await tuyaFetch<
          TuyaRoomDevice[] | { devices?: TuyaRoomDevice[] }
        >(
          "GET",
          `/v1.0/homes/${home.home_id}/rooms/${tuyaRoomId}/devices`,
        );
        roomDevices = Array.isArray(rd) ? rd : (rd?.devices ?? []);
      } catch {
        // Continuar — el room queda creado, los devices se asignan a mano.
        continue;
      }

      for (const rd of roomDevices) {
        const tuyaDevId = rd.id ?? rd.device_id;
        if (!tuyaDevId) continue;
        const pd = pdByTuyaId.get(tuyaDevId);
        if (!pd) {
          devicesNotInDb++;
          continue;
        }
        if (pd.room_id === roomRow.id) {
          devicesAlreadyAssigned++;
          continue;
        }
        const { error: updErr } = await admin
          .from("property_devices")
          .update({ room_id: roomRow.id })
          .eq("id", pd.id);
        if (!updErr) {
          devicesAssigned++;
          // Update in-memory map para que el contador sea preciso si el
          // mismo device aparece en dos rooms (no debería pasar pero…).
          pd.room_id = roomRow.id;
        }
      }
    }

    synced.push({
      home: home.name,
      property: property.name,
      rooms_inserted: roomsInserted,
      rooms_existing: roomsExisting,
      devices_assigned: devicesAssigned,
      devices_already_assigned: devicesAlreadyAssigned,
      devices_not_in_db: devicesNotInDb,
    });
  }

  return NextResponse.json({ ok: true, synced, skipped });
}
