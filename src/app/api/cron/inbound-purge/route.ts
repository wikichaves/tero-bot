import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withCronAlerts } from "@/lib/util/cron-alert";

/**
 * Daily purge of inbound email raw rows older than 30 days. Inbound emails
 * contain guest PII (names, sometimes messages) so we don't keep them
 * indefinitely — the parsed structured data lives on `reservations` and is
 * the long-term source of truth.
 *
 * Protected by CRON_SECRET via Bearer token. Scheduled in vercel.json.
 */

const RETENTION_DAYS = 30;

export const GET = withCronAlerts("inbound-purge", async (request: Request) => {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error, count } = await admin
    .from("airbnb_inbound_emails")
    .delete({ count: "exact" })
    .lt("received_at", cutoff)
    .not("processing_completed_at", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Reuse the existing daily watchdog; never silently purge interrupted work.
  const pendingBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const pending: Record<string, number> = {};
  for (const table of ["airbnb_inbound_emails", "bill_inbound_emails"]) {
    const result = await admin.from(table).select("id", { count: "exact", head: true })
      .is("processing_completed_at", null).lt("received_at", pendingBefore);
    if (result.error) return NextResponse.json({ error: "inbound health query failed" }, { status: 503 });
    pending[table] = result.count ?? 0;
  }
  if (Object.values(pending).some((count) => count > 0)) {
    return NextResponse.json({ error: "Inbound emails need recovery", pending }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    deleted: count ?? 0,
    cutoff,
    retention_days: RETENTION_DAYS,
  });
});
