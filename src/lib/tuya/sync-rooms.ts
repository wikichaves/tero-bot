import { tuyaFetch } from "@/lib/tuya/client";
import { listDevicesGroupedByHome } from "@/lib/tuya/devices";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sincroniza rooms desde Tuya Smart Life hacia la tabla `rooms`
 * (WIK-82 / WIK-98). Llamado por:
 *   - `/api/admin/tuya/sync-rooms` (botón manual, admin)
 *   - `/api/cron/sync` (cron diario)
 *
 * Source of truth para `name` = Tuya. Para `sort_order` = nuestra DB
 * (Tuya Cloud API no expone el orden visual de Smart Life — solo
 * devuelve `room_id` y `name`, en orden de creación). En cada corrida:
 *   - INSERT rooms nuevos con `sort_order = (max existente) + 10`
 *   - UPDATE `name` de rooms que matchean por `tuya_room_id`
 *   - UPDATE `room_id` de `property_devices` que cambiaron de room
 *   - NO toca `sort_order` de rooms existentes (preserva el orden
 *     manual que el admin estableció en /rooms con el dropdown)
 *
 * Lo único que el sync NO machaca es `room_id` de devices con
 * asignación manual divergente, ni rooms creados a mano (matcheo por
 * fuzzy-name).
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
  let m = properties.find((p) => normalize(p.name) === h);
  if (m) return m;
  m = properties.find((p) => {
    const pn = normalize(p.name);
    return pn.includes(h) || h.includes(pn);
  });
  return m ?? null;
}

export type SyncRoomsResult = {
  synced: Array<{
    home: string;
    property: string;
    rooms_inserted: number;
    rooms_existing: number;
    rooms_renamed: number;
    rooms_reordered: number;
    devices_assigned: number;
    devices_already_assigned: number;
    devices_not_in_db: number;
    // Para debug: cómo Tuya nos mandó el array de rooms y qué
    // sort_order le aplicamos. Si el orden visual en Smart Life no
    // coincide con `tuya_idx`, significa que la API de Tuya está
    // devolviendo en algún orden interno (creación) y no podemos
    // usar el índice.
    tuya_order: Array<{
      tuya_idx: number;
      name: string;
      tuya_sort: number | null;
      computed_sort: number;
      previous_sort_in_db: number | null;
      action: "inserted" | "updated" | "noop";
    }>;
  }>;
  skipped: Array<{ home: string; reason: string }>;
};

export async function runSyncRooms(): Promise<SyncRoomsResult> {
  const admin = createAdminClient();

  const grouped = await listDevicesGroupedByHome();
  if (!grouped.user) {
    throw new Error("no Tuya app user linked");
  }

  const { data: properties, error: propsErr } = await admin
    .from("properties")
    .select("id, name");
  if (propsErr) {
    throw new Error(`properties read failed: ${propsErr.message}`);
  }
  const propList = properties ?? [];

  // WIK-95: overrides manuales home → property.
  const { data: overrideRows } = await admin
    .from("tuya_home_overrides")
    .select("tuya_home_id, property_id");
  const overridesByHomeId = new Map<string, string | null>();
  for (const row of (overrideRows ?? []) as Array<{
    tuya_home_id: string;
    property_id: string | null;
  }>) {
    overridesByHomeId.set(row.tuya_home_id, row.property_id);
  }

  const { data: allPDs } = await admin
    .from("property_devices")
    .select("id, tuya_device_id, room_id");
  const pdByTuyaId = new Map(
    (allPDs ?? []).map((pd) => [pd.tuya_device_id, pd]),
  );

  const synced: SyncRoomsResult["synced"] = [];
  const skipped: SyncRoomsResult["skipped"] = [];

  for (const { home } of grouped.homes) {
    const homeIdStr = String(home.home_id);

    // 1. Resolver property (override manual ➔ fuzzy name match).
    let property: { id: string; name: string } | null = null;
    if (overridesByHomeId.has(homeIdStr)) {
      const overridePropertyId = overridesByHomeId.get(homeIdStr);
      if (overridePropertyId == null) {
        skipped.push({ home: home.name, reason: "ignored by manual override" });
        continue;
      }
      property = propList.find((p) => p.id === overridePropertyId) ?? null;
      if (!property) {
        skipped.push({
          home: home.name,
          reason: `override apunta a property inexistente (${overridePropertyId})`,
        });
        continue;
      }
    } else {
      property = matchProperty(home.name, propList);
    }
    if (!property) {
      skipped.push({
        home: home.name,
        reason: `no match (Tuya home_id: ${homeIdStr}). Asigná manualmente en /admin/tuya → mapping de homes.`,
      });
      continue;
    }

    // 2. Pull rooms de Tuya para este home.
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

    const { data: existingRooms } = await admin
      .from("rooms")
      .select("id, name, tuya_room_id, sort_order")
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
    let roomsRenamed = 0;
    const roomsReordered = 0;
    let devicesAssigned = 0;
    let devicesAlreadyAssigned = 0;
    let devicesNotInDb = 0;
    const tuyaOrder: Array<{
      tuya_idx: number;
      name: string;
      tuya_sort: number | null;
      computed_sort: number;
      previous_sort_in_db: number | null;
      action: "inserted" | "updated" | "noop";
    }> = [];

    // Orden inicial para rooms nuevos = max(existing sort_order) + 10.
    // No usamos el índice del array de Tuya porque la API ordena por
    // creation date (room_id ascending), no por orden visual. Para
    // rooms ya existentes en DB, NO machacamos sort_order — el admin
    // controla el orden manualmente en /rooms.
    const maxExistingSort = (existingRooms ?? []).reduce(
      (max, r) => Math.max(max, (r.sort_order as number) ?? 0),
      0,
    );
    let nextNewSort = maxExistingSort + 10;

    for (let idx = 0; idx < rooms.length; idx++) {
      const tr = rooms[idx];
      const trName = String(tr.name ?? "").trim();
      if (!trName) continue;
      const tuyaRoomId = String(tr.room_id);
      const tuyaSort = typeof tr.sort === "number" ? tr.sort : null;

      // Sort para rooms nuevos: siguiente bucket libre arriba de los
      // existentes. Para existentes, no se toca (queda el manual).
      const previousSortInDb =
        existingByTuyaId.get(tuyaRoomId)?.sort_order ??
        existingByName.get(normalize(trName))?.sort_order ??
        null;
      const computedSort = previousSortInDb ?? nextNewSort;
      let trAction: "inserted" | "updated" | "noop" = "noop";

      const byTuyaId = existingByTuyaId.get(tuyaRoomId);
      const byName = byTuyaId
        ? null
        : (existingByName.get(normalize(trName)) ?? null);
      let roomRow = byTuyaId ?? byName ?? null;

      if (!roomRow) {
        const { data: inserted, error: insErr } = await admin
          .from("rooms")
          .insert({
            property_id: property.id,
            name: trName,
            tuya_room_id: tuyaRoomId,
            sort_order: nextNewSort,
          })
          .select("id, name, tuya_room_id, sort_order")
          .single();
        if (insErr || !inserted) continue;
        roomRow = inserted;
        roomsInserted++;
        trAction = "inserted";
        nextNewSort += 10;
        existingByTuyaId.set(tuyaRoomId, roomRow);
        existingByName.set(normalize(roomRow.name), roomRow);
      } else {
        roomsExisting++;
        const updates: Record<string, string | number> = {};

        // Cuando llegamos por fuzzy-name (no por tuya_room_id), siempre
        // completamos el `tuya_room_id` en DB — desde el próximo sync
        // el match va a ser estable por id. Esto cubre el caso WIK-82
        // inicial donde los rooms se crearon sin tuya_room_id.
        const willHaveTuyaId = byTuyaId != null || !roomRow.tuya_room_id;
        if (!roomRow.tuya_room_id) {
          updates.tuya_room_id = tuyaRoomId;
        }

        // UPDATE name si:
        //   - matcheamos por tuya_room_id (estable), o
        //   - matcheamos por name pero el room nunca tuvo tuya_room_id
        //     (lo estamos linkeando recién ahora — Tuya gana).
        // El único caso donde NO updateamos es si el room en DB ya
        // tenía otro tuya_room_id y matcheó por name por casualidad
        // (eso indica que son rooms distintos, dejarlo quieto).
        if (willHaveTuyaId && roomRow.name !== trName) {
          updates.name = trName;
          roomsRenamed++;
        }
        // NO tocamos sort_order: Tuya Cloud API no expone el orden
        // visual de Smart Life, así que la única fuente de truth para
        // el orden es nuestra UI manual (/rooms con el dropdown
        // de mover izq/der). Machacar acá borraría ese orden.

        if (Object.keys(updates).length > 0) {
          const { error: updErr } = await admin
            .from("rooms")
            .update(updates)
            .eq("id", roomRow.id);
          if (!updErr) {
            Object.assign(roomRow, updates);
            existingByTuyaId.set(tuyaRoomId, roomRow);
            trAction = "updated";
          }
        }
      }

      tuyaOrder.push({
        tuya_idx: idx,
        name: trName,
        tuya_sort: tuyaSort,
        computed_sort: computedSort,
        previous_sort_in_db: previousSortInDb,
        action: trAction,
      });

      // Pull devices del room y asignar property_devices.room_id.
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
          pd.room_id = roomRow.id;
        }
      }
    }

    synced.push({
      home: home.name,
      property: property.name,
      rooms_inserted: roomsInserted,
      rooms_existing: roomsExisting,
      rooms_renamed: roomsRenamed,
      rooms_reordered: roomsReordered,
      devices_assigned: devicesAssigned,
      devices_already_assigned: devicesAlreadyAssigned,
      devices_not_in_db: devicesNotInDb,
      tuya_order: tuyaOrder,
    });
  }

  return { synced, skipped };
}
