import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const scriptDir = dirname(fileURLToPath(import.meta.url));
loadDotenv({
  path: process.env.TERO_ENV_PATH ?? resolve(scriptDir, "../.env.local"),
});

const checks = {
  invoice: `
    select property_id, provider, invoice_number, count(*)::int as copies
    from public.utility_bills
    where invoice_number is not null and btrim(invoice_number) <> ''
    group by property_id, provider, invoice_number
    having count(*) > 1`,
  period_account: `
    select property_id, provider, account_number, period_to, count(*)::int as copies
    from public.utility_bills
    where period_to is not null and account_number is not null
    group by property_id, provider, account_number, period_to
    having count(*) > 1`,
  period_without_account: `
    select property_id, provider, period_to, count(*)::int as copies
    from public.utility_bills
    where period_to is not null and account_number is null
    group by property_id, provider, period_to
    having count(*) > 1`,
  fallback: `
    select property_id, provider, utility_type, coalesce(currency, '') as currency,
      amount, coalesce(account_number, '') as account_number,
      coalesce(issue_date, due_date) as identity_date, count(*)::int as copies
    from public.utility_bills
    where invoice_number is null
      and period_to is null
      and amount is not null
      and coalesce(issue_date, due_date) is not null
    group by property_id, provider, utility_type, coalesce(currency, ''), amount,
      coalesce(account_number, ''), coalesce(issue_date, due_date)
    having count(*) > 1`,
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    for (const [name, sql] of Object.entries(checks)) {
      const { rows } = await client.query(sql);
      console.log(`${name}: ${rows.length} duplicate groups`);
      if (rows.length > 0) console.log(JSON.stringify(rows));
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Duplicate audit failed:", (error as Error).message);
  process.exit(1);
});
