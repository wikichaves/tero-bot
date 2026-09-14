/**
 * Reasigna facturas de servicios históricas a la propiedad que realmente es
 * dueña de la cuenta del proveedor, corrigiendo la titularidad accidental que
 * quedó apuntando a Casa Merced.
 *
 * Run: `npm run bills:reassign [--dry-run]`
 *
 * Vive acá y NO en `supabase/schema.sql` a propósito. `db:apply` reproduce el
 * schema entero en cada corrida: si esta reasignación viviera ahí, desharía
 * silenciosamente cualquier corrección manual hecha desde la UI cada vez que
 * alguien aplique el schema. Es un arreglo de datos de una sola vez, no una
 * definición de estructura.
 *
 * Conservador por diseño:
 *   - Solo toca facturas con `account_number` y con una propiedad cuyo
 *     `provider_accounts[provider]` coincide exactamente.
 *   - Si varias propiedades matchean, gana la primera por (sort_order, name),
 *     igual que el SQL original.
 *   - Nunca mueve una factura si en el destino ya existe otra del mismo
 *     proveedor, cuenta y período: eso sería un duplicado, no una corrección.
 *   - --dry-run imprime el plan sin escribir.
 *
 * Lee credenciales service-role de .env.local (bypassea RLS).
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

const dryRun = new Set(process.argv.slice(2)).has("--dry-run");

type PropertyRow = {
  id: string;
  name: string;
  sort_order: number | null;
  provider_accounts: Record<string, string> | null;
};

type BillRow = {
  id: string;
  property_id: string;
  provider: string;
  account_number: string | null;
  period_to: string | null;
};

async function main() {
  const admin = createAdminClient();
  console.log(
    `\x1b[1mReasignación de titularidad de facturas\x1b[0m  ${dryRun ? "(DRY RUN)" : ""}`,
  );

  const { data: propsData, error: propsErr } = await admin
    .from("properties")
    .select("id, name, sort_order, provider_accounts");
  if (propsErr) {
    console.error("no pude leer properties:", propsErr.message);
    process.exit(1);
  }
  const properties = (propsData ?? []) as unknown as PropertyRow[];

  const { data: billsData, error: billsErr } = await admin
    .from("utility_bills")
    .select("id, property_id, provider, account_number, period_to")
    .not("account_number", "is", null);
  if (billsErr) {
    console.error("no pude leer utility_bills:", billsErr.message);
    process.exit(1);
  }
  const bills = (billsData ?? []) as unknown as BillRow[];

  const byId = new Map(properties.map((p) => [p.id, p]));
  // Mismo desempate que el SQL original: sort_order y después name.
  const ordered = [...properties].sort(
    (a, b) =>
      (a.sort_order ?? Number.MAX_SAFE_INTEGER) -
        (b.sort_order ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  );

  let moved = 0;
  let alreadyOk = 0;
  let noMatch = 0;
  let skippedConflict = 0;

  for (const bill of bills) {
    const target = ordered.find(
      (p) => p.provider_accounts?.[bill.provider] === bill.account_number,
    );
    if (!target) {
      noMatch++;
      continue;
    }
    if (target.id === bill.property_id) {
      alreadyOk++;
      continue;
    }

    const conflict = bills.some(
      (other) =>
        other.id !== bill.id &&
        other.property_id === target.id &&
        other.provider === bill.provider &&
        other.account_number === bill.account_number &&
        other.period_to === bill.period_to,
    );
    if (conflict) {
      skippedConflict++;
      console.log(
        `  ⚠ ${bill.provider} ${bill.account_number} ${bill.period_to ?? "sin período"}: ya existe una equivalente en ${target.name}, no la muevo`,
      );
      continue;
    }

    const from = byId.get(bill.property_id)?.name ?? bill.property_id;
    console.log(
      `  ${dryRun ? "movería" : "muevo"}  ${bill.provider} ${bill.account_number} ${bill.period_to ?? "sin período"}:  ${from} → ${target.name}`,
    );

    if (!dryRun) {
      const { error } = await admin
        .from("utility_bills")
        .update({ property_id: target.id })
        .eq("id", bill.id);
      if (error) {
        console.error(`     falló: ${error.message}`);
        continue;
      }
    }
    moved++;
  }

  console.log(
    `\n${dryRun ? "movería" : "movidas"}: ${moved}   ya correctas: ${alreadyOk}   sin cuenta que matchee: ${noMatch}   omitidas por conflicto: ${skippedConflict}`,
  );
  if (dryRun && moved > 0) console.log("Corré sin --dry-run para aplicarlo.");
}

main().catch((err) => {
  console.error("\n❌", err);
  process.exit(1);
});
