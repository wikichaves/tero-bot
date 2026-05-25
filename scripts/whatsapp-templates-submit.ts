/**
 * Submit the WhatsApp templates to Kapso → Meta for approval (or update
 * existing ones).
 *
 * Reads template definitions from `src/lib/whatsapp/templates.ts` (the
 * source of truth), POSTs each one to the Kapso-proxied Meta Cloud API,
 * and prints the resulting template id + initial status. Meta approval
 * typically takes 1-2 days afterwards — use `whatsapp-templates-status.ts`
 * to poll later.
 *
 * Usage:
 *   npm run wa:templates:submit
 *   npm run wa:templates:submit -- --dry-run
 *   npm run wa:templates:submit -- --update   # WIK-171: edita existentes
 *
 * Modos:
 *   default — POST `/<WABA_ID>/message_templates` por cada template.
 *     Falla con "Content in This Language Already Exists" si el template
 *     ya existe en Meta para ese lenguaje. Usalo para templates nuevos.
 *
 *   --update — Primero hace GET de los templates existentes, después para
 *     cada local matchea por `(name, language)`:
 *       · existe en Meta → POST `/<TEMPLATE_ID>` (edit endpoint). El
 *         template vuelve a PENDING para re-approval.
 *       · no existe → POST create (mismo que default mode).
 *     Es lo que querés cuando cambiás el BODY de un template ya aprobado
 *     (ej. el host de las deeplinks WIK-157).
 *
 *   --dry-run — imprime el body que se enviaría sin hacer la llamada.
 *
 * Finding the WABA_ID: Meta Business Manager → Settings → Accounts →
 * WhatsApp Accounts → click the relevant account → look for "Business
 * Account ID" (a 15-16 digit number). Or via Kapso dashboard if exposed.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { allTemplates } from "../src/lib/whatsapp/templates";

// Auto-load .env.local igual que `scripts/db-apply.ts` — sin esto el
// script fallaba con "Missing env var KAPSO_API_KEY" aunque la key
// estuviera en .env.local. Se puede seguir pasando vía shell vars si
// querés override (process.env tiene prioridad sobre dotenv).
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, "../.env.local") });

const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

function envOrFail(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

type RemoteTemplate = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
};

/**
 * Fetch the existing templates from Meta (via Kapso) to build a lookup
 * by (name, language). Used by `--update` mode to decide if we should
 * POST to the edit endpoint or the create endpoint.
 */
async function fetchExistingByKey(
  apiKey: string,
  wabaId: string,
): Promise<Map<string, RemoteTemplate>> {
  const url = `${KAPSO_BASE}/${wabaId}/message_templates?limit=100`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Fetch existing templates failed: HTTP ${res.status}: ${text.slice(0, 400)}`,
    );
  }
  const parsed = JSON.parse(text) as { data?: RemoteTemplate[] };
  const map = new Map<string, RemoteTemplate>();
  for (const t of parsed.data ?? []) {
    if (t.name && t.language) {
      map.set(`${t.name}::${t.language}`, t);
    }
  }
  return map;
}

async function submitCreate(
  apiKey: string,
  wabaId: string,
  template: (typeof allTemplates)[number],
  dryRun: boolean,
): Promise<{ ok: boolean; data?: unknown; error?: string; mode: "create" }> {
  // Meta's POST /<WABA_ID>/message_templates expects exactly this body
  // shape. We strip our internal `description` field (not part of Meta's
  // schema).
  const body = {
    name: template.name,
    language: template.language,
    category: template.category,
    components: template.components,
  };

  if (dryRun) {
    console.log(`  [dry-run] would POST create ${template.name}:`);
    console.log("  " + JSON.stringify(body, null, 2).split("\n").join("\n  "));
    return { ok: true, mode: "create" };
  }

  const url = `${KAPSO_BASE}/${wabaId}/message_templates`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    return {
      ok: false,
      mode: "create",
      error: `HTTP ${res.status}: ${text.slice(0, 400)}`,
    };
  }
  return { ok: true, mode: "create", data: parsed };
}

/**
 * Edit an existing template (WIK-171).
 *
 * Meta directo: `POST /<TEMPLATE_ID>` con `components` actualizados.
 * Pero Kapso es un proxy: si llamamos al template_id directo sin WABA
 * en el path, devuelve HTTP 404 "WhatsApp configuration not found"
 * (no puede rutear). Kapso requiere la WABA en el path siempre.
 *
 * Estrategia: probar 2 URL patterns en orden, primero el más probable
 * (Kapso-style RESTful nested), después la variante con query param.
 * Si los dos fallan con 404 propagamos el último error con un hint en
 * el mensaje para que el operador haga el edit manual en Meta
 * Business Manager (Configuración → Plantillas).
 *
 * Meta no permite cambiar `name` ni `language` (son immutable) — solo
 * los `components` y opcionalmente `category`. El template queda en
 * PENDING para re-approval.
 */
async function submitUpdate(
  apiKey: string,
  wabaId: string,
  templateId: string,
  template: (typeof allTemplates)[number],
  dryRun: boolean,
): Promise<{ ok: boolean; data?: unknown; error?: string; mode: "update" }> {
  const body = {
    category: template.category,
    components: template.components,
  };

  if (dryRun) {
    console.log(
      `  [dry-run] would POST update ${template.name} (id=${templateId}):`,
    );
    console.log("  " + JSON.stringify(body, null, 2).split("\n").join("\n  "));
    return { ok: true, mode: "update" };
  }

  // Pattern 1: Kapso REST nested — `/{waba}/message_templates/{id}`
  // Pattern 2: Meta-style con WABA en query param.
  const candidates = [
    `${KAPSO_BASE}/${wabaId}/message_templates/${templateId}`,
    `${KAPSO_BASE}/${templateId}?waba_id=${wabaId}`,
  ];
  let lastError = "";
  for (const url of candidates) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      return { ok: true, mode: "update", data: parsed };
    }
    lastError = `HTTP ${res.status}: ${text.slice(0, 400)}`;
    // 404 = ruta no soportada por Kapso, intentar la siguiente.
    if (res.status !== 404) break;
  }
  return {
    ok: false,
    mode: "update",
    error:
      `${lastError}\n` +
      `      Hint: si todos los intentos dieron 404, Kapso quizás no\n` +
      `      expone el edit endpoint. Workaround: editá el template\n` +
      `      manualmente en Meta Business Manager → WhatsApp Manager\n` +
      `      → Message templates → click en el template → Edit.`,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const updateMode = process.argv.includes("--update");

  console.log(
    `Submitting ${allTemplates.length} WhatsApp templates via Kapso`,
  );
  console.log(
    `Mode: ${dryRun ? "DRY-RUN" : "LIVE"} · ${
      updateMode ? "UPDATE (edita existentes)" : "CREATE (nuevos)"
    }\n`,
  );

  const apiKey = dryRun
    ? process.env.KAPSO_API_KEY ?? "dry-run"
    : envOrFail("KAPSO_API_KEY");
  const wabaId = dryRun
    ? process.env.WHATSAPP_WABA_ID ?? "dry-run"
    : envOrFail("WHATSAPP_WABA_ID");

  // En --update mode (no dry-run) cargamos primero los existentes para
  // matchear por (name, language) y decidir create vs update por
  // template.
  let existing = new Map<string, RemoteTemplate>();
  if (updateMode && !dryRun) {
    console.log("Fetching existing templates...");
    existing = await fetchExistingByKey(apiKey, wabaId);
    console.log(`Found ${existing.size} template versions in Meta\n`);
  }

  let created = 0;
  let updated = 0;
  let failed = 0;
  for (const t of allTemplates) {
    const key = `${t.name}::${t.language}`;
    const found = existing.get(key);
    const isUpdate = updateMode && !!found?.id;
    const tag = isUpdate ? "UPDATE" : "CREATE";

    process.stdout.write(`→ [${tag}] ${t.name} (${t.category}, ${t.language}) ... `);
    const result = isUpdate
      ? await submitUpdate(apiKey, wabaId, found!.id!, t, dryRun)
      : await submitCreate(apiKey, wabaId, t, dryRun);

    if (result.ok) {
      const tid =
        (result.data as { id?: string } | undefined)?.id ??
        (isUpdate ? found?.id : undefined);
      const status = (result.data as { status?: string } | undefined)?.status;
      console.log(
        `OK${tid ? ` (id=${tid}` : ""}${status ? `, status=${status})` : tid ? ")" : ""}`,
      );
      if (result.mode === "update") updated++;
      else created++;
    } else {
      console.log(`FAILED`);
      console.log(`    ${result.error}`);
      failed++;
    }
  }

  console.log(
    `\nDone: ${created} created, ${updated} updated, ${failed} failed${
      dryRun ? " (dry-run)" : ""
    }`,
  );
  if (!dryRun) {
    console.log(
      `\nMeta usually approves UTILITY templates in 1-2 days. Run`,
    );
    console.log(`  npm run wa:templates:status`);
    console.log(`later to poll for approval status.`);
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("submit script failed:", err);
  process.exit(1);
});
