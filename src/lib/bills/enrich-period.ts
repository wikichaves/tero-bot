import type { Property, UtilityBill } from "@/lib/types";

/**
 * Bill enriched with an "effective" period inferred from neighboring bills
 * when the parser couldn't extract one. The effective period is the window
 * between the previous bill's due_date and this bill's due_date (same
 * property + provider).
 *
 * Lives in lib (not in `/bills`) so /energy can reuse it for the Tuya
 * comparison block (WIK-75).
 */
export type BillRow = UtilityBill & {
  property: Pick<Property, "id" | "name" | "currency"> | null;
};

export type BillRowDerived = BillRow & {
  effective_period_from: string | null;
  effective_period_to: string | null;
  period_inferred: boolean;
};

/**
 * Group bills by (property_id, provider), sort each group by due_date asc
 * (oldest first), then walk: for bill N without an explicit period, infer
 * effective_period_from = due_date(N-1) and effective_period_to =
 * due_date(N). The very-first bill of each group can't infer
 * period_from (no previous neighbor) so it stays null there.
 *
 * Bills with an explicit period_from/to keep it; we just copy into the
 * effective_* fields for uniform downstream code.
 *
 * Output preserves the input ordering (the caller usually sorts by
 * due_date DESC for UI purposes).
 */
export function enrichWithEffectivePeriod(rows: BillRow[]): BillRowDerived[] {
  const groups = new Map<string, BillRow[]>();
  for (const b of rows) {
    const key = `${b.property_id}|${b.provider}`;
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }
  const derivedById = new Map<string, BillRowDerived>();
  for (const list of groups.values()) {
    // Sort by due_date asc; nulls last.
    const sorted = [...list].sort((a, b) => {
      const ad = a.due_date ?? "9999";
      const bd = b.due_date ?? "9999";
      return ad.localeCompare(bd);
    });
    for (let i = 0; i < sorted.length; i++) {
      const bill = sorted[i];
      const hasExplicit = !!(bill.period_from && bill.period_to);
      let effFrom = bill.period_from;
      let effTo = bill.period_to;
      let inferred = false;
      if (!hasExplicit && bill.due_date) {
        effTo = effTo ?? bill.due_date;
        const prev = sorted[i - 1];
        if (!effFrom && prev?.due_date) {
          effFrom = prev.due_date;
        }
        inferred = !!(effFrom && effTo);
      }
      derivedById.set(bill.id, {
        ...bill,
        effective_period_from: effFrom,
        effective_period_to: effTo,
        period_inferred: inferred,
      });
    }
  }
  return rows.map((b) => derivedById.get(b.id)!).filter(Boolean);
}
