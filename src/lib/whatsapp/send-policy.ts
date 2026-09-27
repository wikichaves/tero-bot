/** Pure delivery policy: no network retries after an ambiguous POST result. */
export class WhatsAppSendError extends Error {
  constructor(message: string, readonly metaCode?: number) {
    super(message);
    this.name = "WhatsAppSendError";
  }
}

export function serviceWindowOpen(lastInbound: string | null, now = Date.now()): boolean {
  const timestamp = lastInbound ? Date.parse(lastInbound) : NaN;
  // A minute of margin prevents sending at the edge of Meta's window.
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < 24 * 60 * 60 * 1000 - 60_000;
}

export function mayFallbackLanguage(error: unknown): boolean {
  // 132001: template does not exist in this language. Never retry a timeout,
  // 5xx, auth failure, rate limit or uncertain acceptance in another language.
  return error instanceof WhatsAppSendError && error.metaCode === 132001;
}

export async function decodeSendResponse(res: Response): Promise<{ messageId: string; raw: unknown }> {
  const raw: unknown = await res.json().catch(() => null);
  const payload = raw as { error?: { code?: number }; messages?: { id?: string }[] } | null;
  if (!res.ok) {
    throw new WhatsAppSendError(`WhatsApp rejected request: HTTP ${res.status}, Meta ${payload?.error?.code ?? "unknown"}`, payload?.error?.code);
  }
  const messageId = payload?.messages?.[0]?.id;
  if (!messageId) throw new WhatsAppSendError("WhatsApp acceptance unknown: response has no message id; do not blindly resend");
  return { messageId, raw };
}

/** Use Meta's event time, never delivery-to-our-webhook time (replays can be late). */
export function inboundEventTime(raw: unknown): string | null {
  const timestamp = (raw as { message?: { timestamp?: unknown } } | null)?.message?.timestamp;
  if (typeof timestamp !== "string" && typeof timestamp !== "number") return null;
  const numeric = Number(timestamp);
  const millis = Number.isFinite(numeric) ? numeric * 1000 : Date.parse(String(timestamp));
  return Number.isFinite(millis) && millis > 0 && millis < 8.64e15 ? new Date(millis).toISOString() : null;
}
