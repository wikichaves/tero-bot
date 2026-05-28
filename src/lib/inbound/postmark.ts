/**
 * Shared types + helpers for the Postmark Inbound webhook(s).
 *
 * Postmark posts a JSON payload describing the parsed email. We get one
 * inbound stream for the whole domain — `/api/inbound` dispatches by
 * `To` field to the right handler (airbnb / bills / future).
 */

import { timingSafeEqual } from "node:crypto";

export type PostmarkAttachment = {
  Name: string;
  /** Base64 content. Postmark caps inbound attachments at 35 MB total
   *  payload size; PDFs from utilities are typically <500 KB. */
  Content: string;
  ContentType: string;
  ContentLength: number;
  ContentID?: string;
};

export type PostmarkInbound = {
  MessageID?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  From?: string;
  FromFull?: { Email?: string; Name?: string };
  To?: string;
  ToFull?: Array<{ Email?: string; Name?: string }>;
  OriginalRecipient?: string;
  Attachments?: PostmarkAttachment[];
  Headers?: Array<{ Name: string; Value: string }>;
};

/**
 * Returns true if the `Authorization: Basic …` header matches the
 * `POSTMARK_INBOUND_USER` / `POSTMARK_INBOUND_PASSWORD` env vars.
 * Timing-safe to avoid leaking the credential via response-time diffs.
 */
export function verifyPostmarkBasicAuth(header: string | null): boolean {
  const user = process.env.POSTMARK_INBOUND_USER;
  const password = process.env.POSTMARK_INBOUND_PASSWORD;
  if (!user || !password) {
    console.warn(
      "[inbound] POSTMARK_INBOUND_USER/PASSWORD not set — refusing all",
    );
    return false;
  }
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const expected = `${user}:${password}`;
  const a = Buffer.from(decoded);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Pull the recipient email (local-part) from a Postmark payload. Priority:
 *
 *   1. `OriginalRecipient` — Postmark sets this to the *actual delivery
 *      address* (what they received on their MX). It survives Gmail
 *      auto-forwarding (where `ToFull/To` keep the original mailbox like
 *      `user@gmail.com` and the bills@ alias only appears in `Bcc`/
 *      `X-Forwarded-To`).
 *   2. `ToFull[0].Email` — parsed, only used when OriginalRecipient is
 *      missing (e.g. forwarded to the random Postmark address before MX).
 *   3. `To` — raw header fallback, may include display-name.
 */
export function extractRecipient(body: PostmarkInbound): string | null {
  const candidates: Array<string | undefined | null> = [
    body.OriginalRecipient,
    body.ToFull?.[0]?.Email,
    body.To,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    // Strip `Foo <foo@bar>` → `foo@bar`.
    const m = raw.match(/<([^>]+)>/);
    const addr = (m ? m[1] : raw).trim().toLowerCase();
    if (addr.includes("@")) return addr;
  }
  return null;
}

/** Returns just the local-part of an email (before `@`), lowercased. */
export function localPart(addr: string | null): string | null {
  if (!addr) return null;
  const at = addr.indexOf("@");
  return at > 0 ? addr.slice(0, at).toLowerCase() : addr.toLowerCase();
}
