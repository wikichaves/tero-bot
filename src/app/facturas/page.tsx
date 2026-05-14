import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/tuya/energy";
import { Badge } from "@/components/ui/badge";
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
import type { BillStatus, Property, UtilityBill, UtilityType } from "@/lib/types";
import { BillFormDialog } from "./bill-form-dialog";
import { BillRowActions } from "./bill-row-actions";

/**
 * /facturas — listado de facturas de servicios (luz, agua, internet, alarma).
 *
 * Fuentes de carga:
 *   1. Inbound automático: forwardear el email del proveedor a
 *      `bills@inbound.example.com` (alias soportados:
 *      `luz@`, `agua@`, `internet@`, `alarma@`, `facturas@`). El
 *      router `/api/inbound` detecta el proveedor por sender domain,
 *      sube el PDF a Storage y crea la fila acá.
 *   2. Manual: botón "Nueva factura" arriba a la derecha — para
 *      cargar lo que llega en papel o de proveedores sin parser.
 *
 * Lo que se autocompleta puede quedar parcial (parser hace best-effort
 * sólo sobre el body); cualquier campo se edita después con la lupita.
 */

const UTILITY_LABEL: Record<UtilityType, string> = {
  luz: "Luz",
  agua: "Agua",
  internet: "Internet",
  alarma: "Alarma",
  otro: "Otro",
};

const STATUS_LABEL: Record<BillStatus, string> = {
  pending: "Pendiente",
  paid: "Pagada",
  overdue: "Vencida",
  cancelled: "Cancelada",
};

const STATUS_VARIANT: Record<
  BillStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  paid: "default",
  overdue: "destructive",
  cancelled: "outline",
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

/** Compute the effective status: a bill marked `pending` past its due
 *  date is rendered as overdue — without mutating the DB row. */
function effectiveStatus(b: BillRow, todayIso: string): BillStatus {
  if (b.status === "pending" && b.due_date && b.due_date < todayIso) {
    return "overdue";
  }
  return b.status;
}

export default async function FacturasPage() {
  await requireRole(["admin", "gestor"]);
  const supabase = await createClient();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [billsRes, propertiesRes] = await Promise.all([
    supabase
      .from("utility_bills")
      .select("*, property:properties(id, name, currency)")
      .order("period_to", { ascending: false, nullsFirst: false })
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

  // Totals: pending (or overdue) by currency. Cancelled / paid don't count.
  const totalsByCurrency = new Map<string, number>();
  for (const b of bills) {
    const eff = effectiveStatus(b, todayIso);
    if (eff !== "pending" && eff !== "overdue") continue;
    if (b.amount == null || !b.currency) continue;
    totalsByCurrency.set(
      b.currency,
      (totalsByCurrency.get(b.currency) ?? 0) + b.amount,
    );
  }

  const hasMultipleProperties = properties.length > 1;

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

      {totalsByCurrency.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pendiente de pago</CardTitle>
            <CardDescription>
              Facturas con estado pendiente o vencidas — agrupado por moneda.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-6">
              {Array.from(totalsByCurrency.entries()).map(([curr, total]) => (
                <div key={curr}>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {curr}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {formatMoney(total, curr)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial</CardTitle>
          <CardDescription>
            {bills.length === 0
              ? "Todavía no cargaste ninguna factura."
              : `${bills.length} factura${bills.length === 1 ? "" : "s"} registrada${bills.length === 1 ? "" : "s"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {bills.length === 0 ? (
            <div className="px-4 pb-4 text-sm text-muted-foreground sm:px-0">
              Reenviá el primer email de UTE / OSE / Antel / Edenor /
              AySA / Personal Flow / Prosegur a{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                bills@inbound.example.com
              </code>{" "}
              y vas a verla acá. Mientras, podés usar &laquo;Nueva factura&raquo;.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {hasMultipleProperties && <TableHead>Propiedad</TableHead>}
                    <TableHead>Tipo</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.map((b) => {
                    const eff = effectiveStatus(b, todayIso);
                    return (
                      <TableRow key={b.id}>
                        {hasMultipleProperties && (
                          <TableCell className="font-medium">
                            {b.property?.name ?? "—"}
                          </TableCell>
                        )}
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
                        <TableCell className="whitespace-nowrap">
                          {formatDate(b.due_date)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[eff]}>
                            {STATUS_LABEL[eff]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <BillRowActions bill={b} properties={properties} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
