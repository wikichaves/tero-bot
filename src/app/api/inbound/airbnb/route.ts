import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleAirbnbInbound } from "@/lib/airbnb/handle-inbound";
import {
  verifyPostmarkBasicAuth,
  type PostmarkInbound,
} from "@/lib/inbound/postmark";

/**
 * Legacy direct webhook for Airbnb-only inbound. The newer `/api/inbound`
 * route dispatches by `To` and is preferred — keep this URL configured in
 * Postmark only as a fallback during migration. Once the router is in
 * production, change the Postmark inbound webhook URL to `/api/inbound`
 * (which handles both airbnb and bills).
 */
export async function POST(req: NextRequest) {
  if (!verifyPostmarkBasicAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: PostmarkInbound;
  try {
    body = (await req.json()) as PostmarkInbound;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const admin = createAdminClient();
  return handleAirbnbInbound(body, admin);
}
