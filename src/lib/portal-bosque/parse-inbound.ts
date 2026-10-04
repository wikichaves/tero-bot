import type { PostmarkInbound } from "@/lib/inbound/postmark";

export type WikibotInboundKind = "portal_bosque" | "gmail_forwarding" | "unknown";

export type ParsedWikibotInbound = {
  kind: WikibotInboundKind;
  actionUrl: string | null;
};

const PORTAL_HOSTS = new Set(["portalbosque.com", "www.portalbosque.com"]);
const GOOGLE_HOSTS = new Set([
  "mail-settings.google.com",
  "mail.google.com",
  "accounts.google.com",
]);

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#x3d;/gi, "=")
    .replace(/&#61;/gi, "=")
    .replace(/&quot;/gi, '"');
}

function urls(body: PostmarkInbound): URL[] {
  const content = decodeHtml(`${body.TextBody ?? ""}\n${body.HtmlBody ?? ""}`);
  const matches = content.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return matches.flatMap((raw) => {
    try {
      return [new URL(raw.replace(/[).,;]+$/, ""))];
    } catch {
      return [];
    }
  });
}

export function parseWikibotInbound(body: PostmarkInbound): ParsedWikibotInbound {
  const candidates = urls(body);
  const portal = candidates.find(
    (url) => PORTAL_HOSTS.has(url.hostname.toLowerCase()) &&
      url.pathname === "/confirmar-asistencia" &&
      url.searchParams.has("token"),
  );
  if (portal) return { kind: "portal_bosque", actionUrl: portal.toString() };

  const sender = (body.FromFull?.Email ?? body.From ?? "").toLowerCase();
  const subject = (body.Subject ?? "").toLowerCase();
  const looksLikeGoogleForwarding = /@(?:[a-z0-9-]+\.)*google\.com(?:>|$)/i.test(sender) &&
    (subject.includes("forwarding") || subject.includes("reenvío") || subject.includes("reenvio"));
  if (looksLikeGoogleForwarding) {
    const google = candidates.find((url) => GOOGLE_HOSTS.has(url.hostname.toLowerCase()));
    return { kind: "gmail_forwarding", actionUrl: google?.toString() ?? null };
  }

  return { kind: "unknown", actionUrl: null };
}
