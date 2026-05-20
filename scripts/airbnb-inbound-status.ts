/**
 * Diagnostic for the Airbnb inbound email flow (WIK-61).
 *
 * Run: `pnpm airbnb:status`
 *
 * Reports:
 *   1. Inbound rows in the last 30 minutes (smoke-test signal)
 *   2. Last 10 inbound rows overall
 *   3. Reservations with a `reservation_code` set + enrichment status
 *   4. Property → airbnb_listing_id mapping
 *
 * Read-only — uses the service-role client but never writes.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

// Load .env.local before importing the admin client (the client reads
// env at module init). Using `dotenv` instead of Node's built-in
// `process.loadEnvFile` because the latter silently drops values with
// certain edge-case chars (e.g. long JWT keys with `=` or unquoted).
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const loaded = loadDotenv({ path: envPath });
if (loaded.error) {
  console.error(`Could not load ${envPath}:`, loaded.error.message);
  process.exit(1);
}

// Dynamic require (lazy) so the env vars are in place before the admin
// client reads them at module-init.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createAdminClient } = require("../src/lib/supabase/admin") as {
  createAdminClient: () => ReturnType<typeof import("@supabase/supabase-js").createClient>;
};

const admin = createAdminClient();

function header(s: string) {
  console.log(`\n\x1b[1m═══ ${s} ═══\x1b[0m`);
}

async function main() {
  // 1) Recent inbound rows (last 30 minutes) — the smoke-test signal
  header("Inbound rows in the last 30 minutes");
  const { data: recent, error: recentErr } = await admin
    .from("airbnb_inbound_emails")
    .select("received_at, parsed_kind, parsed, raw")
    .gt(
      "received_at",
      new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    )
    .order("received_at", { ascending: false });
  if (recentErr) {
    console.log(`  ⚠️ ${recentErr.message}`);
  } else if (!recent || recent.length === 0) {
    console.log("  (none)");
  } else {
    for (const r of recent) {
      const code = (r.parsed as { reservation_code?: string })?.reservation_code ?? "—";
      const from =
        (r.raw as { From?: string; FromFull?: { Email?: string } })?.FromFull?.Email ??
        (r.raw as { From?: string })?.From ??
        "?";
      const subject = (r.raw as { Subject?: string })?.Subject ?? "?";
      console.log(`  ${r.received_at}  [${r.parsed_kind}]  ${code}  ${from}`);
      console.log(`    subject: ${subject.slice(0, 80)}`);
    }
  }

  // 2) All inbound rows (overview)
  header("All inbound rows (most recent first, max 10)");
  const { data: all, error: allErr } = await admin
    .from("airbnb_inbound_emails")
    .select("received_at, parsed_kind, parsed, raw")
    .order("received_at", { ascending: false })
    .limit(10);
  if (allErr) {
    console.log(`  ⚠️ ${allErr.message}`);
  } else if (!all || all.length === 0) {
    console.log("  (table empty)");
  } else {
    console.log(`  total in DB (limited to 10 here):`);
    for (const r of all) {
      const code = (r.parsed as { reservation_code?: string })?.reservation_code ?? "—";
      const from =
        (r.raw as { FromFull?: { Email?: string } })?.FromFull?.Email ??
        (r.raw as { From?: string })?.From ??
        "?";
      console.log(`  ${r.received_at}  [${r.parsed_kind}]  ${code}  from=${from}`);
    }
  }

  // 3) Reservations with reservation_code set
  header("Reservations enriched from Airbnb emails");
  const { data: reservations, error: rError } = await admin
    .from("reservations")
    .select(
      "id, reservation_code, guest_name, guest_count, payout_amount, payout_currency, status, check_in, check_out, check_in_time, check_out_time, guest_identity_verified, guest_location, guest_photo_url",
    )
    .not("reservation_code", "is", null)
    .order("check_in", { ascending: false })
    .limit(20);
  if (rError) {
    console.log(`  ⚠️ ${rError.message}`);
  } else if (!reservations || reservations.length === 0) {
    console.log("  (none)");
  } else {
    for (const r of reservations) {
      const enrichment = [
        r.guest_name && "name",
        r.guest_count != null && "count",
        r.payout_amount != null && "payout",
        r.check_in_time && "ci_time",
        r.check_out_time && "co_time",
        r.guest_identity_verified && "verified",
        r.guest_photo_url && "photo",
      ]
        .filter(Boolean)
        .join(",");
      console.log(
        `  ${r.reservation_code}  ${r.check_in}→${r.check_out}  ${r.guest_name ?? "—"}`,
      );
      console.log(
        `    status=${r.status} payout=${r.payout_amount ?? "—"} ${r.payout_currency ?? ""}` +
          ` times=${r.check_in_time ?? "—"}/${r.check_out_time ?? "—"}` +
          ` location=${r.guest_location ?? "—"}` +
          `\n    enriched fields: ${enrichment}`,
      );
    }
  }

  // 4) Property listing-id mapping
  header("Property → airbnb_listing_id mapping");
  const { data: properties, error: pError } = await admin
    .from("properties")
    .select("id, name, airbnb_listing_id")
    .order("name");
  if (pError) {
    console.log(`  ⚠️ ${pError.message}`);
  } else if (!properties || properties.length === 0) {
    console.log("  (no properties — probably wrong env)");
  } else {
    for (const p of properties) {
      console.log(
        `  ${p.name}: ${p.airbnb_listing_id ?? "\x1b[33mnot set\x1b[0m"}`,
      );
    }
  }

  console.log();
}

main().catch((err) => {
  console.error("\n❌", err);
  process.exit(1);
});
