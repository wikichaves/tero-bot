/**
 * Show recent Prosegur inbound bills with PDF text + extracted dates.
 * Run: npx tsx scripts/bills-prosegur-debug.ts
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
  const { data: bills } = await admin
    .from("utility_bills")
    .select(
      "id, amount, due_date, period_from, period_to, issue_date, inbound_email_id, created_at",
    )
    .eq("provider", "Prosegur")
    .order("created_at", { ascending: false })
    .limit(8);
  console.log(`\n═══ Last ${bills?.length ?? 0} Prosegur bills ═══`);
  for (const b of bills ?? []) {
    console.log(
      `  amount=${b.amount} due=${b.due_date} period=${b.period_from}→${b.period_to} issue=${b.issue_date}`,
    );
  }

  const { data: inbound } = await admin
    .from("bill_inbound_emails")
    .select("id, parsed, pdf_text_extract")
    .eq("provider_hint", "Prosegur")
    .order("received_at", { ascending: false })
    .limit(2);
  console.log(`\n═══ PDF text from last 2 Prosegur inbounds ═══`);
  for (const r of inbound ?? []) {
    console.log(`\n─── ${r.id} ───`);
    console.log(`parsed:`, JSON.stringify(r.parsed, null, 2));
    if (r.pdf_text_extract) {
      // Find date-like patterns + nearby context
      const text = r.pdf_text_extract;
      const matches = [
        ...text.matchAll(/[^\n]{0,40}\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b[^\n]{0,40}/gi),
      ];
      console.log(`\n  date patterns found (${matches.length}):`);
      for (const m of matches.slice(0, 20)) {
        console.log(`    > ${m[0].trim()}`);
      }
      const venc = [...text.matchAll(/[^\n]{0,80}venc[^\n]{0,80}/gi)];
      console.log(`\n  "venc" lines (${venc.length}):`);
      for (const v of venc.slice(0, 10)) {
        console.log(`    > ${v[0].trim()}`);
      }
      const compr = [...text.matchAll(/[^\n]{0,80}comprobante[^\n]{0,80}/gi)];
      console.log(`\n  "comprobante" lines (${compr.length}):`);
      for (const c of compr.slice(0, 10)) {
        console.log(`    > ${c[0].trim()}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
