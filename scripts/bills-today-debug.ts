/**
 * Show ALL inbound bill emails from the last 24h.
 * Run: npx tsx scripts/bills-today-debug.ts
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, "../.env.local") });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createAdminClient } = require("../src/lib/supabase/admin") as {
  createAdminClient: () => ReturnType<typeof import("@supabase/supabase-js").createClient>;
};
const admin = createAdminClient();

async function main() {
  console.log("\n═══ Inbound bill emails — last 24h ═══");
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: rows } = await admin
    .from("bill_inbound_emails")
    .select("id, received_at, provider_hint, parsed_kind, parsed, raw")
    .gt("received_at", yesterday)
    .order("received_at", { ascending: false });

  if (!rows || rows.length === 0) {
    console.log("(none)");
    return;
  }
  for (const r of rows) {
    const p = r.parsed as { amount?: number; account_number?: string } | null;
    const raw = r.raw as { From?: string; Subject?: string } | null;
    console.log(
      `\n  ${r.received_at?.slice(0, 19)}  provider=${r.provider_hint}  kind=${r.parsed_kind}`,
    );
    console.log(`    from: ${raw?.From}`);
    console.log(`    subj: ${raw?.Subject}`);
    console.log(`    acc=${p?.account_number} amount=${p?.amount}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
