import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getTemplatesStatus } from "@/lib/whatsapp/templates-status";

/**
 * GET /api/admin/whatsapp/templates-status — pull status actual de los
 * templates del WABA (WIK-78). Útil para chequear approval después
 * del submit sin abrir Kapso dashboard.
 */
export async function GET() {
  await requireRole(["admin"]);
  try {
    const result = await getTemplatesStatus();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
