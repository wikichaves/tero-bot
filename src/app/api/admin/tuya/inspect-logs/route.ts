import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { tuyaFetch } from "@/lib/tuya/client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin diagnostic: dump the raw Tuya `/v1.0/devices/{id}/logs` response
 * for a single device (last 30 days, all DP report events, no client-side
 * filtering). Used to discover which DP codes a given firmware emits
 * when our backfill returns 0 historical rows for a device that clearly
 * has cumulative energy data.
 *
 * Usage:
 *   GET /api/admin/tuya/inspect-logs?device_id=<property_devices.id>
 *   GET /api/admin/tuya/inspect-logs?name=Térmica  (substring match)
 *
 * Returns a summary of distinct DP codes + a sample of the first few
 * logs so the admin can paste the result and we can adjust ENERGY_CODES.
 */
export async function GET(req: NextRequest) {
  await requireRole(["admin"]);
  const params = req.nextUrl.searchParams;
  const deviceId = params.get("device_id");
  const nameMatch = params.get("name");

  const admin = createAdminClient();
  let tuyaDeviceId: string | null = null;
  let propertyDeviceId: string | null = null;
  let deviceName: string | null = null;

  if (deviceId) {
    const { data } = await admin
      .from("property_devices")
      .select("id, tuya_device_id, tuya_device_name")
      .eq("id", deviceId)
      .maybeSingle();
    if (data) {
      tuyaDeviceId = data.tuya_device_id;
      propertyDeviceId = data.id;
      deviceName = data.tuya_device_name;
    }
  } else if (nameMatch) {
    const { data } = await admin
      .from("property_devices")
      .select("id, tuya_device_id, tuya_device_name")
      .ilike("tuya_device_name", `%${nameMatch}%`)
      .limit(1)
      .maybeSingle();
    if (data) {
      tuyaDeviceId = data.tuya_device_id;
      propertyDeviceId = data.id;
      deviceName = data.tuya_device_name;
    }
  }
  if (!tuyaDeviceId) {
    return NextResponse.json(
      { error: "device not found (pass ?device_id=... or ?name=...)" },
      { status: 404 },
    );
  }

  const endMs = Date.now();
  const startMs = endMs - 30 * 24 * 60 * 60 * 1000;

  type LogsResponse = {
    logs?: Array<{
      code: string;
      value: string | number;
      event_time: number;
    }>;
    has_more?: boolean;
    has_next?: boolean;
    last_row_key?: string;
  };

  let r: LogsResponse;
  try {
    r = await tuyaFetch<LogsResponse>(
      "GET",
      `/v1.0/devices/${tuyaDeviceId}/logs`,
      {
        query: {
          type: 7,
          start_time: startMs,
          end_time: endMs,
          size: 100,
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      {
        property_device_id: propertyDeviceId,
        tuya_device_id: tuyaDeviceId,
        device_name: deviceName,
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }

  const logs = r.logs ?? [];
  // Tally codes so we can see which DPs this firmware emits.
  const codeTally = new Map<
    string,
    { count: number; sample_value: string | number; first_event: number; last_event: number }
  >();
  for (const log of logs) {
    const existing = codeTally.get(log.code);
    if (existing) {
      existing.count++;
      existing.last_event = log.event_time;
    } else {
      codeTally.set(log.code, {
        count: 1,
        sample_value: log.value,
        first_event: log.event_time,
        last_event: log.event_time,
      });
    }
  }
  const codes = Array.from(codeTally.entries())
    .map(([code, info]) => ({
      code,
      count: info.count,
      sample_value: info.sample_value,
      first_event: new Date(info.first_event).toISOString(),
      last_event: new Date(info.last_event).toISOString(),
    }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    property_device_id: propertyDeviceId,
    tuya_device_id: tuyaDeviceId,
    device_name: deviceName,
    window_start: new Date(startMs).toISOString(),
    window_end: new Date(endMs).toISOString(),
    total_logs_in_first_page: logs.length,
    has_more: r.has_more ?? r.has_next ?? false,
    distinct_codes: codes,
    sample_logs: logs.slice(0, 8).map((log) => ({
      ...log,
      event_time_iso: new Date(log.event_time).toISOString(),
    })),
  });
}
