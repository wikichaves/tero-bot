import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  computeTuyaConsumption,
  deltaLevel,
  type DeltaLevel,
} from "@/lib/bills/tuya-comparison";
import { formatMoney } from "@/lib/tuya/energy";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Property, UtilityBill, UtilityType } from "@/lib/types";
import { BillFormDialog } from "./bill-form-dialog";
import { BillRowActions } from "./bill-row-actions";

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

const UTILITY_LABEL: Record<UtilityType, string> = {
  luz: "Luz",
  agua: "Agua",
  internet: "Internet",
  alarma: "Alarma",
  otro: "Otro",
};

type BillRow = UtilityBill & {
  property: Pick<Property, "id" | "name" | "currency"> | null;
};

function formatPeriod(from: string | null, to: string | null): string {
  if (!from && !to) return "—";
  if (from && to) {
    const f = format(parseISO(from), "d MMM", { locale: es });
    const t = format(parseISO(to), "d MMM yy", { locale: es });
    return `${f} → ${t}`;
  }
  const single = (from ?? to) as string;
  return format(parseISO(single), "MMM yyyy", { locale: es });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return format(parseISO(iso), "d MMM yyyy", { locale: es });
}

export default async function FacturasPage() {
  await requireRole(["admin", "gestor"]);
  const supabase = await createClient();

  const [billsRes, propertiesRes] = await Promise.all([
    supabase
      .from("utility_bills")
      .select("*, property:properties(id, name, currency)")
      .order("period_to", { ascending: false, nullsFirst: false })
      .order("due_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("properties")
      .select("id, name, currency")
      .order("name"),
  ]);

  const bills = (billsRes.data ?? []) as BillRow[];
  const properties = (propertiesRes.data ?? []) as Pick<
    Property,
    "id" | "name" | "currency"
  >[];

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
          b.period_from &&
          b.period_to,
      )
      .map(async (b) => {
        const result = await computeTuyaConsumption(
          admin,
          b.property_id,
          b.period_from!,
          b.period_to!,
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

  // Group bills by property. We iterate `properties` (alphabetical) so the
  // sections render in a stable order even when one property has no bills.
  const billsByProperty = new Map<string, BillRow[]>();
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
  bills: BillRow[];
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
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead className="text-right">Consumo</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((b) => {
                const cmp = comparisons.get(b.id);
                return (
                  <TableRow key={b.id}>
                    <TableCell>{UTILITY_LABEL[b.utility_type]}</TableCell>
                    <TableCell>{b.provider}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatPeriod(b.period_from, b.period_to)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b.amount != null
                        ? formatMoney(b.amount, b.currency ?? "UYU")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      <ConsumoCell bill={b} comparison={cmp} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(b.due_date)}
                    </TableCell>
                    <TableCell>
                      <BillRowActions bill={b} properties={allProperties} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/** When the Tuya snapshot range covers less than this fraction of the
 *  bill's period, we hide the colored ±% delta (it would be misleading)
 *  and show a gray "parcial XX%" pill instead. 70% chosen as the cutoff
 *  where the delta starts to be meaningful for a residential bill. */
const FULL_COVERAGE_THRESHOLD = 0.7;

function ConsumoCell({
  bill,
  comparison,
}: {
  bill: {
    utility_type: UtilityType;
    kwh_billed: number | null;
    m3_billed: number | null;
  };
  comparison:
    | {
        tuyaKwh: number;
        deltaPct: number;
        level: DeltaLevel;
        coverageFraction: number;
      }
    | undefined;
}) {
  if (bill.utility_type === "luz" && bill.kwh_billed != null) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span>{bill.kwh_billed.toLocaleString("es-UY")} kWh</span>
        {comparison && <DeltaBadge {...comparison} />}
      </div>
    );
  }
  if (bill.utility_type === "agua" && bill.m3_billed != null) {
    return <span>{bill.m3_billed.toLocaleString("es-UY")} m³</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}

function DeltaBadge({
  tuyaKwh,
  deltaPct,
  level,
  coverageFraction,
}: {
  tuyaKwh: number;
  deltaPct: number;
  level: DeltaLevel;
  coverageFraction: number;
}) {
  const tuyaLabel = `${tuyaKwh.toLocaleString("es-UY", {
    maximumFractionDigits: 1,
  })} kWh`;

  // Partial coverage: show a neutral pill with coverage %. The exact ±%
  // would be misleading because we're comparing different time windows.
  if (coverageFraction < FULL_COVERAGE_THRESHOLD) {
    const coveragePct = Math.round(coverageFraction * 100);
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-muted-foreground/40 bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
        title={`Tuya midió ${tuyaLabel} (cobertura ${coveragePct}% del período facturado). Δ% se mostrará cuando haya cobertura completa.`}
      >
        Tuya parcial {coveragePct}%
      </span>
    );
  }

  const sign = deltaPct > 0 ? "+" : "";
  const className =
    level === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : level === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}
      title={`Tuya midió ${tuyaLabel} en el período`}
    >
      Tuya {sign}
      {deltaPct.toLocaleString("es-UY", { maximumFractionDigits: 1 })}%
    </span>
  );
}
