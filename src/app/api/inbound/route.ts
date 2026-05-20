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
 * When the recipient alias doesn't match a known route (e.g. the user is
 * forwarding to the random Postmark-generated address like
 * `719d26d1581cabce04938993c0a10c52@inbound.postmarkapp.com` instead of a
 * custom alias such as `airbnb@inbound.example.com`), we fall
 * back to inferring the sender. This keeps the dispatch working without
 * requiring DNS setup for a custom inbound domain.
 *
 * Patterns are matched against `body.From` (and `FromFull.Email`) using
 * domain-only substring — robust against display-name variants like
 * `"Airbnb" <automated@airbnb.com>`.
 */
function inferRouteFromSender(
  body: PostmarkInbound,
): "airbnb" | null {
  const from = (
    body.FromFull?.Email ??
    body.From ??
    ""
  ).toLowerCase();
  if (from.includes("@airbnb.com") || from.includes("@email.airbnb.com") ||
      from.includes("@automated.airbnb.com") || from.includes(".airbnb.com>")) {
    return "airbnb";
  }
  // Bills are added by alias only — no fallback by sender, because utility
  // companies use many different sender domains and we want explicit opt-in
  // via the `bills@` / `luz@` / `agua@` aliases.
  return null;
}

// Multi-PDF emails (e.g. 7 Edenor bills in one batch) need extra runtime —
// pdf-parse + storage uploads run concurrently but the function still has
// to finish before Vercel kills it. 60s is the Hobby plan cap; Pro can go
// higher. Postmark separately abandons us after 10s, so we still try to
// stay well under that for the happy path.
export const maxDuration = 60;

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

  // Wrap the dispatch in a top-level try/catch so internal bugs (a regex
  // backtrack, a transient DB error, a malformed attachment) never bubble
  // up as a 5xx — Postmark would retry forever on those, even though the
  // retry can't fix the underlying problem. We always ack with 200 and
  // rely on logs + DB rows for triage.
  try {
    if (alias === "airbnb") {
      return await handleAirbnbInbound(body, admin);
    }
    if (alias && BILL_ROUTE_ALIASES.has(alias)) {
      return await handleBillInbound(body, admin, alias);
    }
    // No alias hit — try sender fallback. Lets users forward to the
    // default Postmark inbound address (no custom DNS) and still get
    // their Airbnb emails routed correctly.
    const inferred = inferRouteFromSender(body);
    if (inferred === "airbnb") {
      console.log(
        `[inbound] inferred=airbnb from sender "${body.FromFull?.Email ?? body.From}" (alias="${alias}" didn't match)`,
      );
      return await handleAirbnbInbound(body, admin);
    }
  } catch (err) {
    console.error(
      `[inbound] handler threw for alias="${alias}" recipient="${recipient}":`,
      err,
    );
    return NextResponse.json(
      {
        ok: true,
        internal_error: true,
        message: (err as Error).message,
      },
      { status: 200 },
    );
  }

  // Unrouted: not a known alias and sender doesn't match any handler's
  // signature. Log + ack so Postmark doesn't retry — admin can inspect
  // from Postmark's activity log.
  console.warn(
    `[inbound] unrouted recipient "${recipient}" (alias="${alias}") from "${body.From}"`,
  );
  return NextResponse.json({ ok: true, unrouted: true, recipient });
}
