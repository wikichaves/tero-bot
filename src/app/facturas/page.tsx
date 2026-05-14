import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  computeTuyaConsumption,
  deltaLevel,
  type DeltaLevel,
} from "@/lib/bills/tuya-comparison";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Property, UtilityBill } from "@/lib/types";
import { BillFormDialog } from "./bill-form-dialog";
import { PropertyBillsTable } from "./property-bills-table";

/**
 * /facturas — listado de facturas de servicios (luz, agua, internet, alarma)
 * agrupado por propiedad.
 *
 * Fuentes de carga:
 *   1. Inbound automático: forwardear el email del proveedor a
 *      `bills@inbound.example.com` (alias: luz@/agua@/etc).
 *      El router `/api/inbound` detecta el proveedor por sender domain,
 *      sube el PDF a Storage y crea la fila acá. Si llega un email para
 *      una factura ya existente (misma propiedad + proveedor + período_to),
 *      el handler hace UPDATE en vez de INSERT — no se duplican filas.
 *   2. Manual: botón "Nueva factura" arriba a la derecha — para cargar
 *      lo que llega en papel o de proveedores sin parser.
 *
 * El campo `status` (pending/paid/overdue/cancelled) existe en DB pero
 * no se muestra en la lista — todas las facturas van por débito automático
 * así que el seguimiento de pago no agrega valor visual. Sigue editable
 * desde el dialog si querés marcar manualmente algo cancelled.
 */

type BillRow = UtilityBill & {
  property: Pick<Property, "id" | "name" | "currency"> | null;
};

/** A bill enriched with a derived period when the parser couldn't extract
 *  one. The "effective" period is the window between the previous bill's
 *  due_date and this bill's due_date — useful for Tuya comparison and
 *  for showing a period in the UI even when the PDF didn't surface one. */
type BillRowDerived = BillRow & {
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
 */
function enrichWithEffectivePeriod(rows: BillRow[]): BillRowDerived[] {
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
  // Preserve the original ordering from the SQL query.
  return rows.map((b) => derivedById.get(b.id)!).filter(Boolean);
}

export default async function FacturasPage() {
  await requireRole(["admin", "gestor"]);
  const supabase = await createClient();

  const [billsRes, propertiesRes] = await Promise.all([
    supabase
      .from("utility_bills")
      .select("*, property:properties(id, name, currency)")
      .order("due_date", { ascending: false, nullsFirst: false })
      .order("period_to", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("properties")
      .select("id, name, currency")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  const rawBills = (billsRes.data ?? []) as BillRow[];
  const properties = (propertiesRes.data ?? []) as Pick<
    Property,
    "id" | "name" | "currency"
  >[];

  // Derive `effective_period_from / _to` for bills whose parser didn't
  // surface a period. Heuristic (from user spec): the bill covers the
  // window between the PREVIOUS bill's due_date and THIS bill's due_date,
  // grouped per (property_id, provider). Bills that already have explicit
  // period_from/to keep them as-is.
  const bills: BillRowDerived[] = enrichWithEffectivePeriod(rawBills);

  // Tuya vs facturado: para cada `luz` con período + kWh completo,
  // computamos el consumo medido por Tuya y lo comparamos en el badge
  // de la columna Consumo (parcial cuando coverage < 70%).
  const admin = createAdminClient();
  const comparisons = new Map<
    string,
    {
      tuyaKwh: number;
      deltaPct: number;
      level: DeltaLevel;
      coverageFraction: number;
    }
  >();
  await Promise.all(
    bills
      .filter(
        (b) =>
          b.utility_type === "luz" &&
          b.kwh_billed != null &&
          b.effective_period_from &&
          b.effective_period_to,
      )
      .map(async (b) => {
        const result = await computeTuyaConsumption(
          admin,
          b.property_id,
          b.effective_period_from!,
          b.effective_period_to!,
        );
        if (!result || result.kwh <= 0) return;
        const deltaPct = ((b.kwh_billed! - result.kwh) / result.kwh) * 100;
        comparisons.set(b.id, {
          tuyaKwh: result.kwh,
          deltaPct,
          level: deltaLevel(deltaPct),
          coverageFraction: result.coverageFraction,
        });
      }),
  );

  // Group bills by property. We iterate `properties` (sort_order asc) so
  // the sections render in the order the admin set in /admin/properties.
  const billsByProperty = new Map<string, BillRowDerived[]>();
  for (const b of bills) {
    const list = billsByProperty.get(b.property_id) ?? [];
    list.push(b);
    billsByProperty.set(b.property_id, list);
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Facturas</h1>
          <p className="text-sm text-muted-foreground">
            Forwardeá facturas a{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              bills@inbound.example.com
            </code>{" "}
            o cargá manual. Para backfills históricos, mandá hasta 3–4 PDFs por
            email (Vercel limita el payload a 4.5 MB).
          </p>
        </div>
        <BillFormDialog
          bill={null}
          properties={properties}
          trigger={<Button>Nueva factura</Button>}
        />
      </div>

      {bills.length === 0 ? (
        <Card>
          <CardContent className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
            Reenviá el primer email de UTE / OSE / Antel / Edenor / AySA /
            Personal Flow / Prosegur a{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              bills@inbound.example.com
            </code>{" "}
            y vas a verla acá. Mientras, podés usar &laquo;Nueva factura&raquo;.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {properties.map((property) => {
            const propBills = billsByProperty.get(property.id) ?? [];
            if (propBills.length === 0) return null;
            return (
              <PropertyBillsCard
                key={property.id}
                property={property}
                bills={propBills}
                comparisons={comparisons}
                allProperties={properties}
              />
            );
          })}
          {/* Defensive: bills whose property_id doesn't match any known property
              (deleted property, stale FK) end up in their own catch-all card. */}
          {(() => {
            const knownIds = new Set(properties.map((p) => p.id));
            const orphans = bills.filter((b) => !knownIds.has(b.property_id));
            if (orphans.length === 0) return null;
            return (
              <PropertyBillsCard
                key="orphans"
                property={null}
                bills={orphans}
                comparisons={comparisons}
                allProperties={properties}
              />
            );
          })()}
        </div>
      )}
    </div>
  );
}

function PropertyBillsCard({
  property,
  bills,
  comparisons,
  allProperties,
}: {
  property: Pick<Property, "id" | "name" | "currency"> | null;
  bills: BillRowDerived[];
  comparisons: Map<
    string,
    {
      tuyaKwh: number;
      deltaPct: number;
      level: DeltaLevel;
      coverageFraction: number;
    }
  >;
  allProperties: Pick<Property, "id" | "name" | "currency">[];
}) {
  // The table is a client component (needs useState for the "Mostrar más"
  // toggle). We hand it a plain object instead of a Map — Maps don't
  // serialize across the server→client boundary in Next.
  const comparisonsObj: Record<
    string,
    {
      tuyaKwh: number;
      deltaPct: number;
      level: DeltaLevel;
      coverageFraction: number;
    }
  > = {};
  for (const [k, v] of comparisons) comparisonsObj[k] = v;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {property?.name ?? "Sin propiedad asignada"}
        </CardTitle>
        <CardDescription>
          {bills.length} factura{bills.length === 1 ? "" : "s"}
          {property?.currency ? ` · ${property.currency}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <PropertyBillsTable
          bills={bills}
          comparisons={comparisonsObj}
          allProperties={allProperties}
        />
      </CardContent>
    </Card>
  );
}

