"use client";

import { useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Property, UtilityBill } from "@/lib/types";
import { deleteBill, getBillPdfUrl, markBillPaid } from "./actions";
import { BillFormDialog } from "./bill-form-dialog";

/**
 * Per-row action menu: open PDF (if any), edit, mark paid, delete.
 * Lives next to each row in the bills table. Edit reuses
 * `BillFormDialog` so the form is the single source of truth.
 */
export function BillRowActions({
  bill,
  properties,
}: {
  bill: UtilityBill;
  properties: Pick<Property, "id" | "name" | "currency">[];
}) {
  const [pending, startTransition] = useTransition();

  async function openPdf() {
    const result = await getBillPdfUrl(bill.id);
    if (result?.error) {
      toast.error(result.error);
      return;
    }
    if (!result?.url) {
      toast.message("Esta factura no tiene PDF adjunto.");
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  function onMarkPaid() {
    startTransition(async () => {
      const result = await markBillPaid(bill.id);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Factura marcada como pagada.");
    });
  }

  function onDelete() {
    if (!confirm("¿Eliminar esta factura? No se puede deshacer.")) return;
    startTransition(async () => {
      const result = await deleteBill(bill.id);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Factura eliminada.");
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {bill.pdf_path && (
        <Button
          size="sm"
          variant="outline"
          onClick={openPdf}
          className="h-8"
        >
          PDF
        </Button>
      )}
      <BillFormDialog
        bill={bill}
        properties={properties}
        trigger={
          <Button size="sm" variant="ghost" className="h-8">
            Editar
          </Button>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Más acciones"
              disabled={pending}
            />
          }
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {bill.status !== "paid" && (
            <DropdownMenuItem onClick={onMarkPaid}>
              Marcar como pagada
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
