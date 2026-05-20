/**
 * Re-run the current `parseAirbnbEmail` over previously-stored
 * `airbnb_inbound_emails.raw` payloads and patch the matched reservations
 * with any fields that the older parser missed.
 *
 * Run: `pnpm airbnb:reprocess [--dry-run] [--id <message_id>]`
 *
 * Use case: a parser bug fix lands (e.g. voseo "Ganás" not matching, or
 * `check_in_time` confused by prose) and we want to retro-patch the
 * existing reservations without waiting for the next inbound email. The
 * raw Postmark payload is already in DB, so we just feed it back through.
 *
 * Conservative by design:
 *   - Never overwrites a field that's already non-null (preserves any
 *     human edits + earlier-parsed values that were correct)
 *   - Only acts on inbound rows that point to (or whose `reservation_code`
 *     matches) an existing reservation; never creates new reservations
 *   - --dry-run prints the patch without applying it
 *
 * Reads from .env.local for service-role credentials (bypasses RLS).
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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseAirbnbEmail } = require("../src/lib/airbnb/parse-email") as {
  parseAirbnbEmail: typeof import("../src/lib/airbnb/parse-email").parseAirbnbEmail;
};

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const idIdx = process.argv.indexOf("--id");
const onlyId = idIdx > -1 ? process.argv[idIdx + 1] : null;

type RawPostmark = {
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  Headers?: Array<{ Name?: string; Value?: string }>;
};

async function main() {
  const admin = createAdminClient();

  console.log(
    `\x1b[1mAirbnb inbound reprocess\x1b[0m  ${dryRun ? "(DRY RUN)" : ""}`,
  );

  let query = admin
    .from("airbnb_inbound_emails")
    .select("id, message_id, parsed_kind, parsed, raw, received_at")
    .order("received_at", { ascending: true });
  if (onlyId) query = query.eq("message_id", onlyId);

  const { data: rows, error } = await query;
  if (error) {
    console.error("query failed:", error.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log("(no rows)");
    return;
  }

  let patched = 0;
  let unchanged = 0;
  let orphans = 0;

  for (const row of rows) {
    const raw = row.raw as RawPostmark;
    if (!raw) {
      console.log(`- ${row.message_id}: no raw payload, skipping`);
      continue;
    }
    const reparsed = parseAirbnbEmail({
      subject: raw.Subject ?? "",
      text: raw.TextBody ?? "",
      html: raw.HtmlBody,
      headers: raw.Headers,
    });

    if (reparsed.kind === "unknown" || reparsed.kind === "cancellation") {
      // cancellation is one-shot and idempotent (status=cancelled); we
      // don't re-apply it here. unknown can't be patched.
      console.log(`- ${row.message_id}: kind=${reparsed.kind}, skipping`);
      continue;
    }

    const code = reparsed.reservation_code;
    const { data: reservation } = await admin
      .from("reservations")
      .select(
        "id, guest_name, guest_count, guest_adults, guest_children, guest_infants, guest_identity_verified, guest_location, guest_photo_url, payout_amount, payout_currency, guest_message, check_in_time, check_out_time",
      )
      .eq("source", "airbnb")
      .eq("reservation_code", code)
      .maybeSingle();
    if (!reservation) {
      console.log(`- ${row.message_id} [${code}]: no matching reservation`);
      orphans++;
      continue;
    }

    // Build the patch: only fields that the parser extracted AND the
    // reservation is missing. Preserves human edits + previously-correct
    // parser output.
    const patch: Record<string, unknown> = {};
    const candidates: Array<[string, unknown]> = [
      ["guest_name", reparsed.guest_first_name],
      ["guest_count", reparsed.guest_count],
      ["guest_adults", reparsed.guest_adults],
      ["guest_children", reparsed.guest_children],
      ["guest_infants", reparsed.guest_infants],
      ["guest_identity_verified", reparsed.guest_identity_verified],
      ["guest_location", reparsed.guest_location],
      ["guest_photo_url", reparsed.guest_photo_url],
      ["payout_amount", reparsed.payout_amount],
      ["payout_currency", reparsed.payout_currency],
      ["guest_message", reparsed.guest_message],
      ["check_in_time", reparsed.check_in_time],
      ["check_out_time", reparsed.check_out_time],
    ];
    for (const [col, val] of candidates) {
      if (val == null) continue;
      const current = (reservation as Record<string, unknown>)[col];
      if (current == null) patch[col] = val;
    }

    if (Object.keys(patch).length === 0) {
      console.log(`- ${row.message_id} [${code}]: nothing to add`);
      unchanged++;
      continue;
    }

    console.log(
      `+ ${row.message_id} [${code}]: ${Object.keys(patch).length} new fields →`,
      Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [
          k,
          typeof v === "string" && v.length > 40 ? v.slice(0, 40) + "…" : v,
        ]),
      ),
    );

    if (!dryRun) {
      const { error: updErr } = await admin
        .from("reservations")
        .update(patch)
        .eq("id", reservation.id);
      if (updErr) {
        console.error(`  ⚠️ update failed: ${updErr.message}`);
      } else {
        // Also re-store the new parsed object on the inbound row so we
        // can see the latest interpretation for debugging.
        await admin
          .from("airbnb_inbound_emails")
          .update({ parsed: reparsed })
          .eq("id", row.id);
        patched++;
      }
    } else {
      patched++; // count would-be patches
    }
  }

  console.log(
    `\n${dryRun ? "would patch" : "patched"}: ${patched}   unchanged: ${unchanged}   orphans: ${orphans}`,
  );
}

main().catch((err) => {
  console.error("\n❌", err);
  process.exit(1);
});
