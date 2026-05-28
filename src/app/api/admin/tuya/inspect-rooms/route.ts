import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { tuyaFetch } from "@/lib/tuya/client";
import { listDevicesGroupedByHome } from "@/lib/tuya/devices";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Read-only endpoint para inspeccionar el orden actual de rooms (WIK-98
 * debug). Devuelve, por cada home Tuya:
 *   - el orden que Tuya devuelve (array idx → name + sort)
 *   - el orden que tenemos en la DB
 *
 * Útil para diagnosticar por qué el sort_order no refleja Smart Life.
 * No modifica nada — el user lo abre directo en el browser:
 *   GET <APP_URL>/api/admin/tuya/inspect-rooms
 */
export async function GET() {
  await requireRole(["admin"]);
  const admin = createAdminClient();

  const grouped = await listDevicesGroupedByHome();
  if (!grouped.user) {
    return NextResponse.json(
      { error: "no Tuya app user linked" },
      { status: 400 },
    );
  }

  const result: Array<{
    home: { id: string; name: string };
    tuya_rooms: Array<{
      tuya_idx: number;
      tuya_room_id: string;
      name: string;
      tuya_sort: number | null;
    }>;
    db_rooms: Array<{
      id: string;
      tuya_room_id: string | null;
      name: string;
      sort_order: number;
    }>;
  }> = [];

  for (const { home } of grouped.homes) {
    const homeIdStr = String(home.home_id);

    // 1. Lo que devuelve Tuya.
    type TuyaRoom = {
      room_id: number | string;
      name: string;
      sort?: number;
    };
    let tuyaRooms: TuyaRoom[] = [];
    try {
      const r = await tuyaFetch<TuyaRoom[] | { rooms?: TuyaRoom[] }>(
        "GET",
        `/v1.0/homes/${home.home_id}/rooms`,
      );
      tuyaRooms = Array.isArray(r) ? r : (r?.rooms ?? []);
    } catch {
      result.push({
        home: { id: homeIdStr, name: home.name },
        tuya_rooms: [],
        db_rooms: [],
      });
      continue;
    }

    // 2. Lo que tenemos en DB para todas las properties (no podemos
    //    asociar el home a una property específica acá sin replicar
    //    la lógica de matching — el debug muestra todos los rooms y
    //    el user los relaciona visualmente).
    const tuyaRoomIds = tuyaRooms.map((r) => String(r.room_id));
    const { data: dbRooms } = await admin
      .from("rooms")
      .select("id, tuya_room_id, name, sort_order")
      .in("tuya_room_id", tuyaRoomIds)
      .order("sort_order", { ascending: true });

    result.push({
      home: { id: homeIdStr, name: home.name },
      tuya_rooms: tuyaRooms.map((r, idx) => ({
        tuya_idx: idx,
        tuya_room_id: String(r.room_id),
        name: String(r.name ?? ""),
        tuya_sort: typeof r.sort === "number" ? r.sort : null,
      })),
      db_rooms: (dbRooms ?? []).map((r) => ({
        id: r.id as string,
        tuya_room_id: (r.tuya_room_id as string) ?? null,
        name: r.name as string,
        sort_order: r.sort_order as number,
      })),
    });
  }

  return NextResponse.json({ inspected_at: new Date().toISOString(), homes: result }, {
    headers: { "Cache-Control": "no-store" },
  });
}
