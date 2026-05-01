import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAirbnb, type SyncResult } from "@/lib/airbnb";

/**
 * Daily sync of all properties' Airbnb iCal feeds. Triggered by Vercel cron
 * (see vercel.json) and protected by CRON_SECRET — Vercel sends it as a
 * Bearer token automatically when the env var is set on the project.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const admin = createAdminClient();
  const { data: properties, error } = await admin
    .from("properties")
    .select("id, name, airbnb_ical_url")
    .not("airbnb_ical_url", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Record<string, SyncResult | { error: string }> = {};
  for (const p of properties ?? []) {
    if (!p.airbnb_ical_url) continue;
    try {
      results[p.name] = await syncAirbnb(p.id, p.airbnb_ical_url);
    } catch (e) {
      results[p.name] = { error: (e as Error).message };
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    properties: results,
  });
}
