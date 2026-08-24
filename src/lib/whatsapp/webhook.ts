import { createHmac, timingSafeEqual } from "node:crypto";

/** Types and pure helpers shared by the Kapso webhook boundary. */
export type KapsoTextContent = { body?: string };

export type KapsoStatusError = {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
  href?: string;
};

export type KapsoMessage = {
  id?: string;
  from?: string;
  to?: string;
  type?: string;
  text?: KapsoTextContent;
  image?: { link?: string; caption?: string };
  audio?: { link?: string };
  video?: { link?: string };
  timestamp?: string | number;
  kapso?: { direction?: "inbound" | "outbound" };
  errors?: KapsoStatusError[];
  error?: KapsoStatusError | KapsoStatusError[];
  status?: string;
};

export type KapsoStatus = {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: KapsoStatusError[];
};

export type KapsoContact = {
  wa_id?: string;
  profile?: { name?: string };
};

export type KapsoEvent = {
  message?: KapsoMessage;
  status?: KapsoStatus | string;
  contacts?: KapsoContact[];
  phone_number_id?: string;
};

export type KapsoWebhookBody = {
  type?: string;
  data?: KapsoEvent[];
};

export function isAutoReplyEnabled(): boolean {
  const value = process.env.WHATSAPP_AUTO_REPLY_ENABLED?.toLowerCase();
  return value !== "false" && value !== "0" && value !== "no";
}

export function verifyKapsoSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  let expectedBuffer: Buffer;
  let signatureBuffer: Buffer;
  try {
    expectedBuffer = Buffer.from(expected, "hex");
    signatureBuffer = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return (
    expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer)
  );
}

/**
 * In production the signature secret is mandatory. Local development stays
 * ergonomic, but production never silently exposes a write-capable webhook.
 */
export function requiresKapsoSignature(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Ignore events for another WhatsApp number sharing the Kapso account. */
export function belongsToConfiguredPhoneNumber(event: KapsoEvent): boolean {
  const configured = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return !configured || !event.phone_number_id || event.phone_number_id === configured;
}

export function extractBody(message: KapsoMessage): string | null {
  if (message.type === "text") return message.text?.body ?? null;
  if (message.type === "image") return message.image?.caption ?? null;
  return null;
}

export function extractMediaUrl(message: KapsoMessage): string | null {
  return message.image?.link ?? message.audio?.link ?? message.video?.link ?? null;
}

/** Normalize Kapso's batch, flat, and Meta-compatible delivery payloads. */
export function normalizeKapsoStatus(
  event: KapsoEvent,
  eventType?: string | null,
): KapsoStatus | null {
  const raw = event.status;
  if (typeof raw === "string") {
    const id = event.message?.id;
    return id ? { id, status: raw } : null;
  }
  if (raw) {
    const id = raw.id ?? event.message?.id;
    return id ? { ...raw, id } : null;
  }

  const match = /^whatsapp\.message\.(sent|delivered|read|failed)$/.exec(
    eventType ?? "",
  );
  if (!match || !event.message?.id) return null;

  return {
    id: event.message.id,
    status: match[1],
    recipient_id: event.message.to,
    errors: extractKapsoErrors(event.message),
  };
}

/** Find a Meta error without coupling the handler to a single Kapso shape. */
export function extractKapsoErrors(
  value: unknown,
  depth = 0,
): KapsoStatusError[] | undefined {
  if (!value || typeof value !== "object" || depth > 3) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["errors", "error"]) {
    const candidate = record[key];
    if (!candidate) continue;
    const errors = (Array.isArray(candidate) ? candidate : [candidate]).filter(
      (error) => error && typeof error === "object",
    ) as KapsoStatusError[];
    if (errors.length > 0) return errors;
  }
  for (const candidate of Object.values(record)) {
    if (candidate && typeof candidate === "object") {
      const errors = extractKapsoErrors(candidate, depth + 1);
      if (errors) return errors;
    }
  }
  return undefined;
}

/** Field paths only — safe to log when an unfamiliar failure payload arrives. */
export function describeKapsoShape(
  value: unknown,
  path = "",
  depth = 0,
): string[] {
  if (!value || typeof value !== "object" || depth > 2) return [];
  const record = value as Record<string, unknown>;
  return Object.entries(record).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    return child && typeof child === "object" && !Array.isArray(child)
      ? describeKapsoShape(child, childPath, depth + 1)
      : [childPath];
  });
}
