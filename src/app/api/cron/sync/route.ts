import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAirbnb, type SyncResult } from "@/lib/airbnb/sync";
import { runSyncRooms, type SyncRoomsResult } from "@/lib/tuya/sync-rooms";
import { withCronAlerts } from "@/lib/util/cron-alert";
import { isTransientError, withRetry } from "@/lib/util/concurrent";

export const maxDuration = 60;

type SyncFailure = {
  step: "airbnb" | "tuyaRooms";
  reason: string;
  property?: string;
  transient?: true;
};

export const maxDuration = 60;

/**
 * Daily sync (Vercel cron). Hace:
 *   1. Pull de iCal de Airbnb por cada property (reservas)
 *   2. Sync de rooms + device→room mappings desde Tuya Smart Life
 *      (nombres y orden de Tuya pisan los de la DB — WIK-98 v3)
 *
 * Protegido por CRON_SECRET (Bearer automático de Vercel).
 */
export const GET = withCronAlerts("sync", async (request: Request) => {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const startedAt = Date.now();
  const ranAt = new Date().toISOString();
  const failures: SyncFailure[] = [];

  // 1. Airbnb iCal sync.
  const admin = createAdminClient();
  let airbnbResults:
    | Record<string, SyncResult | { error: string }>
    | { error: string } = {};
  try {
    const properties = await withRetry(
      async () => {
        const { data, error } = await admin
          .from("properties")
          .select("id, name, airbnb_ical_url")
          .not("airbnb_ical_url", "is", null)
          .abortSignal(AbortSignal.timeout(8000));
        if (error) throw new Error(error.message);
        return data;
      },
      { shouldRetry: (retryError) => isTransientError(retryError) },
    ).catch((cause: unknown) => {
      const message = String((cause as Error)?.message ?? cause);
      const readError = new Error(`properties read failed: ${message}`);
      if (isTransientError(cause)) {
        Object.assign(readError, {
          dependency: "supabase.properties",
          transient: true,
        });
      }
      throw readError;
    });

    for (const p of properties ?? []) {
      if (!p.airbnb_ical_url) continue;
      try {
        airbnbResults[p.name] = await syncAirbnb(p.id, p.airbnb_ical_url);
      } catch (e) {
        const reason = (e as Error).message;
        airbnbResults[p.name] = { error: reason };
        failures.push({ step: "airbnb", property: p.name, reason });
      }
    }
  } catch (e) {
    const reason = (e as Error).message;
    airbnbResults = { error: reason };
    failures.push({
      step: "airbnb",
      reason,
      ...(isTransientError(e) ? { transient: true as const } : {}),
    });
  }

  // 2. Tuya rooms sync (name + sort_order). Best-effort — un fallo acá
  // no debe romper el sync de Airbnb.
  let tuyaRooms: SyncRoomsResult | { error: string };
  try {
    tuyaRooms = await runSyncRooms();
  } catch (e) {
    const reason = (e as Error).message;
    tuyaRooms = { error: reason };
    failures.push({
      step: "tuyaRooms",
      reason,
      ...(isTransientError(e) ? { transient: true as const } : {}),
    });
  }

  const response = {
    ranAt,
    airbnb: airbnbResults,
    tuyaRooms,
  };
  if (failures.length === 0) {
    return NextResponse.json(response);
  }

  console.log(
    JSON.stringify({
      event: "cron.sync.degraded",
      ranAt,
      totalMs: Date.now() - startedAt,
      failures: failures.map((failure) => ({
        ...failure,
        reason: failure.reason.slice(0, 500),
      })),
    }),
  );

  const failedSteps = new Set(failures.map((failure) => failure.step));
  const allStepsFailed = failedSteps.size === 2;
  return NextResponse.json(
    allStepsFailed
      ? { ...response, transient: true, failures }
      : { ...response, degraded: true, failures },
    { status: allStepsFailed ? 503 : 200 },
  );
});
