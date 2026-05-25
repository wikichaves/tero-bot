/**
 * Delete WhatsApp templates from Meta (via Kapso) por name.
 *
 * Workflow típico para forzar re-create limpio (cuando el edit endpoint
 * de Kapso no aguanta, ej. después de la migración de dominio WIK-130):
 *
 *   1. npm run wa:templates:delete-all:dry   # preview qué se borra
 *   2. npm run wa:templates:delete-all       # borrado real
 *   3. npm run wa:templates:submit           # crea de nuevo con el
 *                                            # body actual del código
 *   4. Esperar 1-2 días, Meta aprueba.
 *
 * Meta's DELETE endpoint:
 *   DELETE /<WABA_ID>/message_templates?name=<NAME>
 *
 * Borra TODAS las versiones de language para un name dado en una sola
 * call. Así que iteramos sobre `allTemplates` deduplicando por `name`
 * (no por (name, language)) — son 8 calls, no 16.
 *
 * Idempotente: si el template no existe, Meta devuelve algo razonable
 * (200 con success=false o 404). Loggeamos como "skip" y seguimos.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { allTemplates } from "../src/lib/whatsapp/templates";

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

async function deleteOne(
  apiKey: string,
  wabaId: string,
  templateName: string,
  dryRun: boolean,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (dryRun) {
    console.log(
      `  [dry-run] would DELETE /v24.0/${wabaId}/message_templates?name=${templateName}`,
    );
    return { ok: true };
  }
  const url = `${KAPSO_BASE}/${wabaId}/message_templates?name=${encodeURIComponent(templateName)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { "X-API-Key": apiKey },
  });
  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: `HTTP ${res.status}: ${text.slice(0, 400)}`,
    };
  }
  return { ok: true, status: res.status };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Dedup por name — DELETE by name borra todas las versiones de
  // language de una.
  const uniqueNames = Array.from(
    new Set(allTemplates.map((t) => t.name)),
  ).sort();

  console.log(
    `Deleting ${uniqueNames.length} WhatsApp templates (by name) via Kapso`,
  );
  console.log(`Mode: ${dryRun ? "DRY-RUN (no API calls)" : "LIVE"}\n`);

  if (!dryRun) {
    console.log(
      "⚠ Esto borra los templates de Meta. Tendrás que re-submitirlos con",
    );
    console.log(
      "  `npm run wa:templates:submit` después. Quedan PENDING ~1-2 días.\n",
    );
  }

  const apiKey = dryRun
    ? process.env.KAPSO_API_KEY ?? "dry-run"
    : envOrFail("KAPSO_API_KEY");
  const wabaId = dryRun
    ? process.env.WHATSAPP_WABA_ID ?? "dry-run"
    : envOrFail("WHATSAPP_WABA_ID");

  let deleted = 0;
  let failed = 0;
  for (const name of uniqueNames) {
    process.stdout.write(`→ DELETE ${name} ... `);
    const result = await deleteOne(apiKey, wabaId, name, dryRun);
    if (result.ok) {
      console.log(`OK`);
      deleted++;
    } else {
      console.log(`FAILED`);
      console.log(`    ${result.error}`);
      failed++;
    }
  }

  console.log(
    `\nDone: ${deleted} deleted, ${failed} failed${dryRun ? " (dry-run)" : ""}`,
  );
  if (!dryRun && deleted > 0) {
    console.log(
      `\nNext step: npm run wa:templates:submit  # recrea con el body actual`,
    );
  }
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("delete script failed:", err);
  process.exit(1);
});
