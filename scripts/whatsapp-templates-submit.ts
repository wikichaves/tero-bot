/**
 * Submit the 4 WhatsApp templates to Kapso → Meta for approval.
 *
 * Reads template definitions from `src/lib/whatsapp/templates.ts` (the
 * source of truth), POSTs each one to the Kapso-proxied Meta Cloud API,
 * and prints the resulting template id + initial status. Meta approval
 * typically takes 1-2 days afterwards — use `whatsapp-templates-status.ts`
 * to poll later.
 *
 * Usage:
 *   KAPSO_API_KEY=... WHATSAPP_WABA_ID=... npx tsx scripts/whatsapp-templates-submit.ts
 *
 * Re-running is safe: Meta rejects duplicate names within the same WABA
 * with a clear error and we skip past it. The dry-run flag below prints
 * what WOULD be sent without actually calling the API:
 *
 *   npx tsx scripts/whatsapp-templates-submit.ts --dry-run
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

async function submitOne(
  apiKey: string,
  wabaId: string,
  template: (typeof allTemplates)[number],
  dryRun: boolean,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
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
    console.log(`  [dry-run] would POST ${template.name}:`);
    console.log("  " + JSON.stringify(body, null, 2).split("\n").join("\n  "));
    return { ok: true };
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
      error: `HTTP ${res.status}: ${text.slice(0, 400)}`,
    };
  }
  return { ok: true, data: parsed };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Submitting ${allTemplates.length} WhatsApp templates via Kapso`);
  console.log(`Mode: ${dryRun ? "DRY-RUN (no API calls)" : "LIVE"}\n`);

  const apiKey = dryRun
    ? process.env.KAPSO_API_KEY ?? "dry-run"
    : envOrFail("KAPSO_API_KEY");
  const wabaId = dryRun
    ? process.env.WHATSAPP_WABA_ID ?? "dry-run"
    : envOrFail("WHATSAPP_WABA_ID");

  let submitted = 0;
  let failed = 0;
  for (const t of allTemplates) {
    process.stdout.write(`→ ${t.name} (${t.category}, ${t.language}) ... `);
    const result = await submitOne(apiKey, wabaId, t, dryRun);
    if (result.ok) {
      const tid = (result.data as { id?: string } | undefined)?.id;
      const status = (result.data as { status?: string } | undefined)?.status;
      console.log(
        `OK${tid ? ` (id=${tid}` : ""}${status ? `, status=${status})` : tid ? ")" : ""}`,
      );
      submitted++;
    } else {
      console.log(`FAILED`);
      console.log(`    ${result.error}`);
      failed++;
    }
  }

  console.log(
    `\nDone: ${submitted} submitted, ${failed} failed${dryRun ? " (dry-run)" : ""}`,
  );
  console.log(
    `\nMeta usually approves UTILITY templates in 1-2 days. Run`,
  );
  console.log(`  npx tsx scripts/whatsapp-templates-status.ts`);
  console.log(`later to poll for approval status.`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("submit script failed:", err);
  process.exit(1);
});
