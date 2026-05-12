import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daily purge of inbound email raw rows older than 30 days. Inbound emails
 * contain guest PII (names, sometimes messages) so we don't keep them
 * indefinitely — the parsed structured data lives on `reservations` and is
 * the long-term source of truth.
 *
 * Protected by CRON_SECRET via Bearer token. Scheduled in vercel.json.
 */

const RETENTION_DAYS = 30;

export async function GET(request: Request) {
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
    .lt("received_at", cutoff);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    deleted: count ?? 0,
    cutoff,
    retention_days: RETENTION_DAYS,
  });
}
