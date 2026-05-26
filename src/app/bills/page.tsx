import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { createClient } from "@/lib/supabase/server";
import {
  enrichWithEffectivePeriod,
  type BillRow,
  type BillRowDerived,
} from "@/lib/bills/enrich-period";
import { INBOUND_DOMAIN } from "@/lib/brand";
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
 * /bills — listado de facturas de servicios (luz, agua, internet, alarma)
 * agrupado por propiedad.
 *
 * Fuentes de carga:
 *   1. Inbound automático: forwardear el email del proveedor al alias
 *      `bills@<INBOUND_DOMAIN>` (alias: luz@/agua@/etc).
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
  const profile = await requireRole(["admin", "gestor"]);
  // WIK-94: scope por property.
  const allowedIds = await getAllowedPropertyIds(profile);
  const supabase = await createClient();
  const t = await getTranslations("billsPage");

  let billsQuery = supabase
    .from("utility_bills")
    .select("*, property:properties(id, name, currency)")
    .order("due_date", { ascending: false, nullsFirst: false })
    .order("period_to", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (allowedIds !== null) billsQuery = billsQuery.in("property_id", allowedIds);

  let propsQuery = supabase
    .from("properties")
    .select("id, name, currency")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (allowedIds !== null) propsQuery = propsQuery.in("id", allowedIds);

  const [billsRes, propertiesRes] = await Promise.all([billsQuery, propsQuery]);

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

  const inboundCode = INBOUND_DOMAIN
    ? `bills@${INBOUND_DOMAIN}`
    : t("subtitleFallback");

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div>
          <h1 className="text-4xl">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitlePre")}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {inboundCode}
            </code>
            {t("subtitlePost")}
          </p>
        </div>
        <BillFormDialog
          bill={null}
          properties={properties}
          trigger={<Button>{t("newBill")}</Button>}
        />
      </div>

      {bills.length === 0 ? (
        <Card>
          <CardContent className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
            {t("emptyPre")}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {inboundCode}
            </code>
            {t("emptyPost")}
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

async function PropertyBillsCard({
  property,
  bills,
  allProperties,
}: {
  property: Pick<Property, "id" | "name" | "currency"> | null;
  bills: BillRowDerived[];
  allProperties: Pick<Property, "id" | "name" | "currency">[];
}) {
  const t = await getTranslations("billsPage");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {property?.name ?? t("noProperty")}
        </CardTitle>
        <CardDescription>
          {t("billsCount", { n: bills.length })}
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
