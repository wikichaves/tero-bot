/**
 * Poll Kapso → Meta for the current approval status of all message
 * templates registered on this WABA. Prints a table with name, status,
 * and rejection reason (if any).
 *
 * Usage:
 *   KAPSO_API_KEY=... WHATSAPP_WABA_ID=... npx tsx scripts/whatsapp-templates-status.ts
 *
 * Useful workflow after submitting:
 *   1. Run submit script → all 4 templates show PENDING
 *   2. Wait 1-2 days
 *   3. Run this status script → expect 4 APPROVED
 *   4. If any REJECTED, read the reason, fix the template body in
 *      `src/lib/whatsapp/templates.ts`, re-submit just that one.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { allTemplates } from "../src/lib/whatsapp/templates";

// Auto-load .env.local (mismo patrón que db-apply + submit scripts).
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
  category?: string;
  rejected_reason?: string | null;
};

async function fetchAll(
  apiKey: string,
  wabaId: string,
): Promise<RemoteTemplate[]> {
  // Meta paginates at ~25 by default; we ask for 100 which is the cap
  // for this endpoint. For more we'd follow `paging.next`, but in this
  // project we only have 4 templates so one page covers it.
  const url = `${KAPSO_BASE}/${wabaId}/message_templates?limit=100`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const parsed = JSON.parse(text) as { data?: RemoteTemplate[] };
  return parsed.data ?? [];
}

function statusEmoji(s: string | undefined): string {
  switch (s) {
    case "APPROVED":
      return "✅";
    case "PENDING":
      return "⏳";
    case "REJECTED":
      return "❌";
    case "PAUSED":
      return "⏸️";
    case "DISABLED":
      return "🚫";
    default:
      return "❓";
  }
}

async function main() {
  const apiKey = envOrFail("KAPSO_API_KEY");
  const wabaId = envOrFail("WHATSAPP_WABA_ID");

  // WIK-124 paso 8: la decisión "mock vs real send" se hace en runtime
  // por env vars en `src/lib/alarm-reminders/send.ts`. Logueamos acá la
  // config actual para que el operador vea de un vistazo si los crons
  // van a mandar de verdad o quedan en log-only.
  const mockEnabled = process.env.MOCK_WHATSAPP_TEMPLATES === "true";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const sendMode = mockEnabled
    ? "🟡 MOCK (env MOCK_WHATSAPP_TEMPLATES=true)"
    : phoneNumberId
      ? "🟢 LIVE"
      : "🟡 MOCK (falta WHATSAPP_PHONE_NUMBER_ID)";
  console.log(`Send mode: ${sendMode}`);
  console.log();

  const remote = await fetchAll(apiKey, wabaId);
  console.log(`Templates registradas en WABA ${wabaId}: ${remote.length}`);
  console.log();

  // WIK-156: matchear por (name, language) — un mismo `name` puede
  // existir en Meta dos veces (es + en) y son rows distintas con IDs
  // distintos. El mapping viejo `byName` colapsaba las dos versiones
  // y mostraba solo una.
  const byKey = new Map<string, RemoteTemplate>();
  for (const t of remote) {
    if (t.name && t.language) byKey.set(`${t.name}::${t.language}`, t);
  }

  console.log(
    `${"name".padEnd(34)} ${"lang".padEnd(5)} ${"status".padEnd(12)} ${"id".padEnd(20)} reason`,
  );
  console.log("─".repeat(95));

  for (const local of allTemplates) {
    const key = `${local.name}::${local.language}`;
    const r = byKey.get(key);
    if (!r) {
      console.log(
        `${local.name.padEnd(34)} ${(local.language ?? "").padEnd(5)} ${statusEmoji(undefined)} ${"NOT_SUBMITTED".padEnd(10)} ${"—".padEnd(20)} run submit script`,
      );
      continue;
    }
    const status = r.status ?? "?";
    const id = r.id ?? "—";
    const reason = r.rejected_reason ? ` ${r.rejected_reason}` : "";
    console.log(
      `${local.name.padEnd(34)} ${(local.language ?? "").padEnd(5)} ${statusEmoji(status)} ${status.padEnd(10)} ${id.padEnd(20)}${reason}`,
    );
  }

  // Flag any remote templates we don't have locally (probably submitted
  // ad-hoc from the dashboard — worth knowing). Matchear también por
  // (name, language) para no flagear erróneamente la versión en de un
  // template que sí tenemos pero solo en es.
  const localKeys = new Set(
    allTemplates.map((t) => `${t.name}::${t.language}`),
  );
  const extras = remote.filter(
    (r) => r.name && r.language && !localKeys.has(`${r.name}::${r.language}`),
  );
  if (extras.length > 0) {
    console.log();
    console.log(
      `⚠ ${extras.length} template version(es) en Meta NO presentes en código:`,
    );
    for (const e of extras) {
      console.log(`  ${e.name} (${e.language}) — ${e.status}`);
    }
  }

  const allApproved = allTemplates.every(
    (t) => byKey.get(`${t.name}::${t.language}`)?.status === "APPROVED",
  );
  console.log();
  console.log(
    allApproved
      ? "✓ Todos los templates están APPROVED — listo para outbound."
      : "ℹ Falta(n) template(s) por aprobar.",
  );
}

main().catch((err) => {
  console.error("status script failed:", err);
  process.exit(1);
});
