import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { backfillAllDevices } from "@/lib/tuya/backfill";

/**
 * Admin-only one-shot backfill: pulls daily kWh history from Tuya's
 * Statistics API for every energy-monitored device and writes synthetic
 * `energy_snapshots` rows at 00:00 UTC of each day. Lets historical
 * `utility_bills` (especially the seven Edenor PDFs we just ingested)
 * be compared against measured consumption — the regular cron only
 * collects forward.
 *
 * POST /api/admin/tuya/backfill-snapshots
 *   body: { months?: number }   (default 12, max 24)
 *
 * Returns a per-device report with how many rows were inserted, skipped
 * as duplicates, and the anchor / computed totals (useful to spot if
 * Tuya's stats came back empty or in unexpected units).
 */

// Tuya stats can be slow per device + serial across devices. Give the
// function plenty of headroom; 12 months × 2 meters ≈ 5–10s total.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  await requireRole(["admin"]);

  let months = 12;
  try {
    const body = (await req.json()) as { months?: number } | null;
    if (body?.months && Number.isFinite(body.months)) {
      months = Math.min(24, Math.max(1, Math.floor(body.months)));
    }
  } catch {
    // body is optional — fall back to default.
  }

  const startedAt = Date.now();
  const results = await backfillAllDevices(months);
  const elapsedMs = Date.now() - startedAt;

  const summary = {
    months,
    devicesProcessed: results.length,
    inserted: results.reduce((s, r) => s + r.inserted, 0),
    skipped_duplicate: results.reduce((s, r) => s + r.skipped_duplicate, 0),
    errors: results.filter((r) => r.error).length,
    elapsedMs,
  };

  console.log("[tuya backfill] summary:", summary);
  return NextResponse.json({ ok: true, summary, results });
}
