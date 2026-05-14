import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  enrichWithEffectivePeriod,
  type BillRow,
  type BillRowDerived,
} from "@/lib/bills/enrich-period";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Property } from "@/lib/types";
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
  //
  // (WIK-75) Antes calculábamos también el delta Tuya vs facturado acá y
  // lo mostrábamos en una columna "Consumo" — la mayoría de las filas
  // (internet/alarma/agua) la dejaban vacía y ensuciaba la tabla. Ahora
  // la comparativa vive en /energy junto a los devices Tuya.
  const bills: BillRowDerived[] = enrichWithEffectivePeriod(rawBills);

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
  allProperties,
}: {
  property: Pick<Property, "id" | "name" | "currency"> | null;
  bills: BillRowDerived[];
  allProperties: Pick<Property, "id" | "name" | "currency">[];
}) {
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
          allProperties={allProperties}
        />
      </CardContent>
    </Card>
  );
}

