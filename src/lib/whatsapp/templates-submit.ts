import "server-only";
import { allTemplates, type WhatsAppTemplate } from "./templates";

/**
 * Lógica de submit de templates a Kapso/Meta (WIK-78). Antes vivía solo
 * en `scripts/whatsapp-templates-submit.ts` pero ese script necesita
 * `KAPSO_API_KEY` localmente — Vercel CLI no permite descargar encrypted
 * env vars. Para evitar pasar la key a mano, exponemos la misma lógica
 * a través de un admin-protected endpoint que se ejecuta desde Vercel
 * (donde sí tiene acceso a las env vars).
 *
 * El script y el endpoint comparten esta función — single source of truth.
 */

const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

export type TemplateSubmitResult = {
  name: string;
  ok: boolean;
  template_id?: string;
  status?: string;
  error?: string;
};

async function submitOne(
  apiKey: string,
  wabaId: string,
  template: WhatsAppTemplate,
): Promise<TemplateSubmitResult> {
  const body = {
    name: template.name,
    language: template.language,
    category: template.category,
    components: template.components,
  };
  const url = `${KAPSO_BASE}/${wabaId}/message_templates`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: { id?: string; status?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep raw */
    }
    if (!res.ok) {
      // Caso especial: "Content in This Language Already Exists" (subcode
      // 2388024). Meta tira 400 cuando intentamos crear una template con
      // el mismo nombre+language de una ya existente. NO es un error
      // genuino — la template está OK en Meta, solo que ya la teníamos.
      // Lo marcamos `ok: true` con status especial para que el UI no
      // alarme al admin con un FAILED rojo.
      type MetaError = {
        error?: { error_subcode?: number };
      };
      const parsedErr = (() => {
        try {
          return JSON.parse(text) as MetaError;
        } catch {
          return null;
        }
      })();
      if (parsedErr?.error?.error_subcode === 2388024) {
        return {
          name: template.name,
          ok: true,
          status: "ALREADY_EXISTS",
        };
      }
      return {
        name: template.name,
        ok: false,
        // Devolvemos el body completo (no truncado) — los errores de Meta
        // muchas veces incluyen el motivo de rejection o trace_id en
        // user_title / error_data y necesitamos verlos para debug.
        error: `HTTP ${res.status}: ${text}`,
      };
    }
    return {
      name: template.name,
      ok: true,
      template_id: parsed.id,
      status: parsed.status,
    };
  } catch (e) {
    return {
      name: template.name,
      ok: false,
      error: (e as Error).message,
    };
  }
}

/**
 * Submit todas las templates registradas. Devuelve un array con el
 * resultado per template. Meta rechaza duplicates dentro del mismo
 * WABA — si un template ya fue submitted, el error te lo dice y lo
 * skippeamos en futuros reruns.
 */
export async function submitAllTemplates(): Promise<{
  results: TemplateSubmitResult[];
  total: number;
  submitted: number;
  failed: number;
}> {
  const apiKey = process.env.KAPSO_API_KEY;
  const wabaId = process.env.WHATSAPP_WABA_ID;
  if (!apiKey) throw new Error("KAPSO_API_KEY not set");
  if (!wabaId) throw new Error("WHATSAPP_WABA_ID not set");

  const results: TemplateSubmitResult[] = [];
  // Submit secuencial para que el log/respuesta tenga orden estable.
  // Meta no tira rate limit en 5 calls back-to-back.
  for (const t of allTemplates) {
    results.push(await submitOne(apiKey, wabaId, t));
  }
  const submitted = results.filter((r) => r.ok).length;
  const failed = results.length - submitted;
  return { results, total: results.length, submitted, failed };
}
