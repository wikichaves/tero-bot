import "server-only";
import { allTemplates } from "./templates";

/**
 * Query a Kapso/Meta el status actual de todos los templates (WIK-78).
 * Pareja del `templates-submit.ts` — usada por el botón "Refresh status"
 * en `/admin/whatsapp` y por el script `wa:templates:status`.
 *
 * Devuelve el join entre los templates locales y los registrados en el
 * WABA. Útil para ver:
 *   - Cuáles ya están APPROVED y se pueden usar
 *   - Cuáles están PENDING (esperar)
 *   - Cuáles REJECTED + el motivo (para corregir y resubmit)
 *   - Cuáles nunca fueron submitted
 */

const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

export type RemoteTemplate = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  rejected_reason?: string | null;
};

export type TemplateStatusEntry = {
  name: string;
  status:
    | "APPROVED"
    | "PENDING"
    | "REJECTED"
    | "PAUSED"
    | "DISABLED"
    | "NOT_SUBMITTED"
    | "UNKNOWN";
  template_id: string | null;
  rejected_reason: string | null;
};

export async function getTemplatesStatus(): Promise<{
  entries: TemplateStatusEntry[];
  extras: RemoteTemplate[];
  all_approved: boolean;
}> {
  const apiKey = process.env.KAPSO_API_KEY;
  const wabaId = process.env.WHATSAPP_WABA_ID;
  if (!apiKey) throw new Error("KAPSO_API_KEY not set");
  if (!wabaId) throw new Error("WHATSAPP_WABA_ID not set");

  const url = `${KAPSO_BASE}/${wabaId}/message_templates?limit=100&fields=name,id,status,language,category,rejected_reason`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const parsed = JSON.parse(text) as { data?: RemoteTemplate[] };
  const remote = parsed.data ?? [];

  const byName = new Map<string, RemoteTemplate>();
  for (const r of remote) {
    if (r.name) byName.set(r.name, r);
  }

  const entries: TemplateStatusEntry[] = allTemplates.map((local) => {
    const r = byName.get(local.name);
    if (!r) {
      return {
        name: local.name,
        status: "NOT_SUBMITTED",
        template_id: null,
        rejected_reason: null,
      };
    }
    const known: TemplateStatusEntry["status"][] = [
      "APPROVED",
      "PENDING",
      "REJECTED",
      "PAUSED",
      "DISABLED",
    ];
    const s = (r.status ?? "UNKNOWN") as TemplateStatusEntry["status"];
    return {
      name: local.name,
      status: known.includes(s) ? s : "UNKNOWN",
      template_id: r.id ?? null,
      rejected_reason: r.rejected_reason ?? null,
    };
  });

  const localNames = new Set(allTemplates.map((t) => t.name));
  const extras = remote.filter((r) => r.name && !localNames.has(r.name));
  const all_approved = entries.every((e) => e.status === "APPROVED");

  return { entries, extras, all_approved };
}
