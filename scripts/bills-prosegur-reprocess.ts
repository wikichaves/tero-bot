/**
 * Re-extract due_date + issue_date for existing Prosegur bills using the
 * stored pdf_text_extract. Updates utility_bills in place.
 *
 * Run: npx tsx scripts/bills-prosegur-reprocess.ts
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

// Inline the Prosegur-relevant regex (parse-email.ts can't be required from
// scripts because it `import "server-only"`s).
function normalizePdfWhitespace(s: string): string {
  return s
    .replace(/([a-záéíóúñü])([A-ZÁÉÍÓÚÑÜ])/g, "$1 $2")
    .replace(/([a-záéíóúñüA-ZÁÉÍÓÚÑÜ])(\d)/g, "$1 $2")
    .replace(/(\d)([a-záéíóúñüA-ZÁÉÍÓÚÑÜ])/g, "$1 $2");
}
function parseDmy(raw: string): string | null {
  const m = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function extractDueDate(body: string): string | null {
  const m = /Fecha\s+de\s+Vencimiento[ \t:]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i.exec(body);
  return m ? parseDmy(m[1]) : null;
}
function extractIssueDate(body: string): string | null {
  const m = /Fecha\s+del\s+comprobante[ \t:]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i.exec(body);
  return m ? parseDmy(m[1]) : null;
}

async function main() {
  const { data: inbound } = await admin
    .from("bill_inbound_emails")
    .select("id, pdf_text_extract, raw")
    .eq("provider_hint", "Prosegur")
    .not("pdf_text_extract", "is", null);
  console.log(`Found ${inbound?.length ?? 0} Prosegur inbound emails with pdf text`);

  for (const r of inbound ?? []) {
    const normalized = normalizePdfWhitespace(r.pdf_text_extract as string);
    const reparsed = {
      due_date: extractDueDate(normalized),
      issue_date: extractIssueDate(normalized),
    };
    console.log(
      `\n${r.id.slice(0, 8)} → due=${reparsed.due_date} issue=${reparsed.issue_date}`,
    );

    if (!reparsed.due_date && !reparsed.issue_date) {
      console.log(`  ⚠ no dates extracted, skip`);
      continue;
    }
    const { data: bill } = await admin
      .from("utility_bills")
      .select("id, due_date, issue_date, amount")
      .eq("inbound_email_id", r.id)
      .maybeSingle();
    if (!bill) {
      console.log(`  ⚠ no utility_bills row linked, skipping`);
      continue;
    }
    console.log(
      `  current: due=${bill.due_date} issue=${bill.issue_date} amount=${bill.amount}`,
    );

    if (
      reparsed.due_date === bill.due_date &&
      reparsed.issue_date === bill.issue_date
    ) {
      console.log(`  ✓ already correct, skip`);
      continue;
    }
    const { error } = await admin
      .from("utility_bills")
      .update({
        due_date: reparsed.due_date,
        issue_date: reparsed.issue_date,
      })
      .eq("id", bill.id);
    if (error) {
      console.log(`  ✗ update failed:`, error.message);
    } else {
      console.log(`  ✓ updated → due=${reparsed.due_date} issue=${reparsed.issue_date}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
