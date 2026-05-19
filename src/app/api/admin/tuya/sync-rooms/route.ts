import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { runSyncRooms } from "@/lib/tuya/sync-rooms";

/**
 * Admin endpoint (WIK-82 Fase 1): sincronizar rooms + device→room
 * mappings desde Tuya Smart Life.
 *
 * La lógica vive en `lib/tuya/sync-rooms.ts` para que también la pueda
 * llamar el cron diario (`/api/cron/sync`) sin requireRole.
 */
export async function POST() {
  await requireRole(["admin"]);
  try {
    const result = await runSyncRooms();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
