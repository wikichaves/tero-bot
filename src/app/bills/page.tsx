import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { getActiveCountry, getCountryPropertyIds } from "@/lib/country";
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
import { BillFormDialog } from "./bill-form-dialog";
import { PropertyBillsTable } from "./property-bills-table";
import { billDeduplicationKey, getBillingGroup, type BillingGroup, type BillingProperty } from "@/lib/bills/billing-groups";

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
  const countryPropertyIds = await getCountryPropertyIds(await getActiveCountry(allowedIds), allowedIds);
  const supabase = await createClient();
  const t = await getTranslations("billsPage");

  let billsQuery = supabase
    .from("utility_bills")
    .select("*, property:properties(id, name, currency, padron)")
    .order("due_date", { ascending: false, nullsFirst: false })
    .order("period_to", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  billsQuery = billsQuery.in("property_id", countryPropertyIds);

  let propsQuery = supabase
    .from("properties")
    .select("id, name, currency, padron")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  propsQuery = propsQuery.in("id", countryPropertyIds);

  const [billsRes, propertiesRes] = await Promise.all([billsQuery, propsQuery]);

  const rawBills = (billsRes.data ?? []) as BillRow[];
  const properties = (propertiesRes.data ?? []) as BillingProperty[];

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

  // WIK-227: ordenar más nuevo primero. La query ya pide due_date DESC, pero
  // las facturas sin due_date (carga manual, o parseos que sacaron period_to
  // sin vencimiento) caían al fondo aunque fueran recientes. Reordenamos por
  // la fecha más representativa de cada factura — fin de período efectivo, con
  // fallback a vencimiento y luego a created_at — de forma descendente.
  const billDateKey = (b: BillRowDerived): string =>
    b.effective_period_to ?? b.due_date ?? b.created_at.slice(0, 10);
  bills.sort((a, b) => billDateKey(b).localeCompare(billDateKey(a)));

  // Group by padrón (or shared internet connection). A shared invoice is
  // kept once, while the table receives the number of properties to divide
  // the amount by for the per-property view.
  const billsByGroup = new Map<string, { group: BillingGroup; bills: BillRowDerived[] }>();
  for (const b of bills) {
    const property = properties.find((p) => p.id === b.property_id) ?? null;
    const group = getBillingGroup(property, properties, b.utility_type);
    const entry = billsByGroup.get(group.key) ?? { group, bills: [] };
    if (!entry.bills.some((existing) => billDeduplicationKey(existing) === billDeduplicationKey(b))) {
      entry.bills.push(b);
    }
    billsByGroup.set(group.key, entry);
  }

  const inboundCode = INBOUND_DOMAIN
    ? `bills@${INBOUND_DOMAIN}`
    : t("subtitleFallback");

  return (
    <div className="flex flex-col gap-6">
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
          {[...billsByGroup.values()].map(({ group, bills: groupBills }) => (
            <PropertyBillsCard
              key={group.key}
              group={group}
              bills={groupBills}
              allProperties={properties}
            />
          ))}
        </div>
      )}
    </div>
  );
}

async function PropertyBillsCard({
  group,
  bills,
  allProperties,
}: {
  group: BillingGroup;
  bills: BillRowDerived[];
  allProperties: BillingProperty[];
}) {
  const t = await getTranslations("billsPage");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {group.label}
        </CardTitle>
        <CardDescription>
          {t("billsCount", { n: bills.length })}
          {group.properties.length > 0 ? " · " + group.properties.map((property) => property.name).join(" + ") : " · " + t("noProperty")}
          {group.allocationCount > 1 ? " · dividido entre " + group.allocationCount : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <PropertyBillsTable
          bills={bills}
          allProperties={allProperties}
          allocationCount={group.allocationCount}
        />
      </CardContent>
    </Card>
  );
}
