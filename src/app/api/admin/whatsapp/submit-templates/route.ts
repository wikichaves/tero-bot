import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { submitAllTemplates } from "@/lib/whatsapp/templates-submit";

/**
 * Admin endpoint para submitar las 5 WhatsApp templates a Kapso/Meta
 * (WIK-78). Se ejecuta desde Vercel donde tiene acceso a las env vars
 * (KAPSO_API_KEY + WHATSAPP_WABA_ID) — alternativa al script local
 * `npm run wa:templates:submit` que requiere las creds locally.
 *
 * Idempotente: Meta rechaza duplicates con un error claro, lo cual se
 * persiste en el response y se puede ignorar en re-runs.
 *
 * POST /api/admin/whatsapp/submit-templates  (admin role)
 *
 * Returns:
 *   { total, submitted, failed, results: [{ name, ok, template_id?, status?, error? }] }
 */
export async function POST() {
  await requireRole(["admin"]);
  try {
    const result = await submitAllTemplates();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
