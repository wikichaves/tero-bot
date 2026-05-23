"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Property, UtilityBill, UtilityType } from "@/lib/types";
import { createBill, updateBill } from "./actions";

/**
 * Combined create / edit dialog for a utility bill. Pass `bill={null}` to
 * use it in create mode (rendered by the "Nueva factura" button), or
 * `bill={existing}` to edit. The component is fully client-side and calls
 * the relevant server action on submit.
 */
export function BillFormDialog({
  bill,
  properties,
  trigger,
}: {
  bill: UtilityBill | null;
  properties: Pick<Property, "id" | "name" | "currency">[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [utility, setUtility] = useState<UtilityType>(
    bill?.utility_type ?? "luz",
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      property_id: String(fd.get("property_id") ?? ""),
      utility_type: String(fd.get("utility_type") ?? "luz") as UtilityType,
      provider: String(fd.get("provider") ?? ""),
      amount: String(fd.get("amount") ?? ""),
      currency: String(fd.get("currency") ?? ""),
      period_from: String(fd.get("period_from") ?? ""),
      period_to: String(fd.get("period_to") ?? ""),
      issue_date: String(fd.get("issue_date") ?? ""),
      due_date: String(fd.get("due_date") ?? ""),
      paid_at: String(fd.get("paid_at") ?? ""),
      status: String(fd.get("status") ?? "pending") as
        | "pending"
        | "paid"
        | "overdue"
        | "cancelled",
      kwh_billed: String(fd.get("kwh_billed") ?? ""),
      m3_billed: String(fd.get("m3_billed") ?? ""),
      account_number: String(fd.get("account_number") ?? ""),
      invoice_number: String(fd.get("invoice_number") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    };

    startTransition(async () => {
      const result = bill
        ? await updateBill(bill.id, payload)
        : await createBill(payload);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(bill ? "Factura actualizada." : "Factura creada.");
      setOpen(false);
    });
  }

  // Default currency follows the selected property; if the admin overrides
  // it manually the value stays.
  const initialProperty = properties.find((p) => p.id === bill?.property_id);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {bill ? "Editar factura" : "Nueva factura"}
            </DialogTitle>
            <DialogDescription>
              {bill
                ? "Modificá lo que el parser dejó incompleto."
                : "Cargá una factura manualmente — por ejemplo si te llegó en papel."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="property_id">Propiedad</Label>
                <select
                  id="property_id"
                  name="property_id"
                  required
                  defaultValue={bill?.property_id ?? properties[0]?.id ?? ""}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.currency})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="utility_type">Tipo</Label>
                <select
                  id="utility_type"
                  name="utility_type"
                  value={utility}
                  onChange={(e) =>
                    setUtility(e.currentTarget.value as UtilityType)
                  }
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="luz">Luz</option>
                  <option value="agua">Agua</option>
                  <option value="internet">Internet</option>
                  <option value="alarma">Alarma</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_140px_100px] gap-3">
              <div className="grid gap-2">
                <Label htmlFor="provider">Proveedor</Label>
                <Input
                  id="provider"
                  name="provider"
                  defaultValue={bill?.provider ?? ""}
                  placeholder="ej. UTE, Edenor, Antel"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="amount">Importe</Label>
                <Input
                  id="amount"
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={
                    bill?.amount != null ? String(bill.amount) : ""
                  }
                  placeholder="0"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="currency">Moneda</Label>
                <Input
                  id="currency"
                  name="currency"
                  maxLength={3}
                  defaultValue={
                    bill?.currency ?? initialProperty?.currency ?? "UYU"
                  }
                  className="uppercase"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="period_from">Período desde</Label>
                <Input
                  id="period_from"
                  name="period_from"
                  type="date"
                  defaultValue={bill?.period_from ?? ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="period_to">Período hasta</Label>
                <Input
                  id="period_to"
                  name="period_to"
                  type="date"
                  defaultValue={bill?.period_to ?? ""}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="issue_date">Fecha emisión</Label>
                <Input
                  id="issue_date"
                  name="issue_date"
                  type="date"
                  defaultValue={bill?.issue_date ?? ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="due_date">Vencimiento</Label>
                <Input
                  id="due_date"
                  name="due_date"
                  type="date"
                  defaultValue={bill?.due_date ?? ""}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="status">Estado</Label>
                <select
                  id="status"
                  name="status"
                  defaultValue={bill?.status ?? "pending"}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="pending">Pendiente</option>
                  <option value="paid">Pagada</option>
                  <option value="overdue">Vencida</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="paid_at">Pagada el</Label>
                <Input
                  id="paid_at"
                  name="paid_at"
                  type="date"
                  defaultValue={bill?.paid_at ?? ""}
                />
              </div>
            </div>

            {utility === "luz" && (
              <div className="grid gap-2">
                <Label htmlFor="kwh_billed">kWh facturados</Label>
                <Input
                  id="kwh_billed"
                  name="kwh_billed"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={
                    bill?.kwh_billed != null ? String(bill.kwh_billed) : ""
                  }
                />
              </div>
            )}
            {utility === "agua" && (
              <div className="grid gap-2">
                <Label htmlFor="m3_billed">m³ facturados</Label>
                <Input
                  id="m3_billed"
                  name="m3_billed"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={
                    bill?.m3_billed != null ? String(bill.m3_billed) : ""
                  }
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="account_number">Nº de cuenta</Label>
                <Input
                  id="account_number"
                  name="account_number"
                  defaultValue={bill?.account_number ?? ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invoice_number">Nº de factura</Label>
                <Input
                  id="invoice_number"
                  name="invoice_number"
                  defaultValue={bill?.invoice_number ?? ""}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notas</Label>
              <textarea
                id="notes"
                name="notes"
                rows={2}
                defaultValue={bill?.notes ?? ""}
                placeholder="Detalles internos sobre la factura"
                className="resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
