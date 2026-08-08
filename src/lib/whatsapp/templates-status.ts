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
  /** WIK-320: idioma de ESTA variante (`es` | `en`). Meta aprueba cada una
   *  por separado, así que sin este campo dos filas con el mismo nombre eran
   *  indistinguibles y el estado de la variante EN quedaba oculto. */
  language: string;
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
  /**
   * WIK-316: categoría que Meta tiene REALMENTE asignada, vs. la que
   * declaramos localmente. Ya la pedíamos en `fields=` pero la
   * descartábamos.
   *
   * Importa porque Meta re-categoriza templates por su cuenta: si pasa un
   * UTILITY a MARKETING, queda sujeto a los límites de marketing y empieza
   * a NO entregarse fuera de la ventana de 24h — aunque el status siga
   * diciendo APPROVED. Es un modo de falla silencioso que ya nos pasó
   * (ver nota de `staff_welcome` v2 en templates.ts) y que sin esto no se
   * puede ver desde la app.
   */
  category: string | null;
  local_category: string | null;
  /** true si Meta la re-categorizó respecto de lo que declaramos. */
  category_mismatch: boolean;
};

export async function getTemplatesStatus(): Promise<{
  entries: TemplateStatusEntry[];
  extras: RemoteTemplate[];
  all_approved: boolean;
  /** Templates que Meta re-categorizó (entregan mal aunque estén APPROVED). */
  recategorized: TemplateStatusEntry[];
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
  // WIK-320: índice por (nombre, idioma). Meta registra cada variante de
  // idioma por separado, con su propia aprobación.
  const byLangName = new Map<string, RemoteTemplate>();
  for (const r of remote) {
    if (!r.name) continue;
    byName.set(r.name, r);
    if (r.language) byLangName.set(`${r.name}|${r.language}`, r);
  }

  const entries: TemplateStatusEntry[] = allTemplates.map((local) => {
    // WIK-320: matchear por (nombre, idioma), NO sólo por nombre.
    //
    // Cada template existe dos veces con el MISMO nombre: variante `es` y
    // variante `en`. Meta las trata como registros independientes, cada una
    // con su propia aprobación. Al indexar sólo por nombre, ambas variantes
    // locales caían en el mismo registro remoto y la pantalla mostraba el
    // mismo estado repetido — así que si la variante EN estaba PENDING o
    // REJECTED, era literalmente invisible.
    //
    // Importa porque el idioma por defecto de `profiles.language` es `en`:
    // a un destinatario con ese default le mandamos la variante EN, y si esa
    // no está aprobada Meta acepta el envío pero después falla la entrega
    // (el fallback a `es` sólo salta ante un error HTTP inmediato, no ante
    // un fallo asíncrono de entrega).
    const r =
      byLangName.get(`${local.name}|${local.language}`) ??
      byName.get(local.name);
    if (!r) {
      return {
        name: local.name,
        language: local.language,
        status: "NOT_SUBMITTED",
        template_id: null,
        rejected_reason: null,
        category: null,
        local_category: local.category,
        category_mismatch: false,
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
    const remoteCategory = r.category ?? null;
    return {
      name: local.name,
      language: local.language,
      status: known.includes(s) ? s : "UNKNOWN",
      template_id: r.id ?? null,
      rejected_reason: r.rejected_reason ?? null,
      category: remoteCategory,
      local_category: local.category,
      category_mismatch:
        remoteCategory != null && remoteCategory !== local.category,
    };
  });

  const localNames = new Set(allTemplates.map((t) => t.name));
  const extras = remote.filter((r) => r.name && !localNames.has(r.name));
  const all_approved = entries.every((e) => e.status === "APPROVED");
  // WIK-316: un template re-categorizado por Meta entrega mal aunque esté
  // APPROVED — lo exponemos aparte para que el operador lo vea de una.
  const recategorized = entries.filter((e) => e.category_mismatch);

  return { entries, extras, all_approved, recategorized };
}
