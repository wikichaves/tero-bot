import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleAirbnbInbound } from "@/lib/airbnb/handle-inbound";
import {
  BILL_ROUTE_ALIASES,
  handleBillInbound,
} from "@/lib/bills/handle-inbound";
import {
  extractRecipient,
  localPart,
  verifyPostmarkBasicAuth,
  type PostmarkInbound,
} from "@/lib/inbound/postmark";

/**
 * Single Postmark Inbound entrypoint. Postmark posts every email that
 * arrives at *@inbound.example.com here; we dispatch by the
 * `To` (local-part) alias to the right handler:
 *
 *   airbnb@                              → handleAirbnbInbound
 *   bills@ / facturas@ / luz@ / agua@ /  → handleBillInbound
 *     internet@ / alarma@
 *
 * Anything else is logged + 200'd so Postmark doesn't retry.
 *
 * Migration: configure the Postmark inbound webhook URL to this path
 * (`/api/inbound`) — the older `/api/inbound/airbnb` route still works
 * during the cutover so we can roll back without losing emails.
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
  const recipient = extractRecipient(body);
  const alias = localPart(recipient);

  if (alias === "airbnb") {
    return handleAirbnbInbound(body, admin);
  }
  if (alias && BILL_ROUTE_ALIASES.has(alias)) {
    return handleBillInbound(body, admin, alias);
  }

  // Unrouted: probably a misconfigured forward. Log + ack so Postmark
  // doesn't retry — admin can inspect from Postmark's activity log.
  console.warn(
    `[inbound] unrouted recipient "${recipient}" (alias="${alias}")`,
  );
  return NextResponse.json({ ok: true, unrouted: true, recipient });
}
