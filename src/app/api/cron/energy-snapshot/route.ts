import { NextResponse } from "next/server";
import { snapshotAllDevices } from "@/lib/tuya/snapshots";

/**
 * Hourly cron — captures one snapshot per energy-capable property_device.
 * Configured in vercel.json. Vercel sends the CRON_SECRET as a Bearer token.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await snapshotAllDevices();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
