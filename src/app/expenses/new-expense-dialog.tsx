"use client";

import { useState, type InputHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createExpense } from "./actions";

type Property = { id: string; name: string };

export function NewExpenseDialog({ properties, currency }: { properties: Property[]; currency: string }) {
  const t = useTranslations("newExpenseDialog");
  const [open, setOpen] = useState(false);
  async function submit(formData: FormData) { await createExpense(formData); setOpen(false); }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button />}>{t("title")}</DialogTrigger>
    <DialogContent mobileSheet className="sm:max-w-2xl">
      <form action={submit} className="grid gap-4">
        <DialogHeader><DialogTitle>{t("title")}</DialogTitle><DialogDescription>{t("description")}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><Field label={t("fields.date")} name="expense_date" type="date" /><Field label={t("fields.vendor")} name="vendor" placeholder={t("placeholders.vendor")} /><Field label={t("fields.amount")} name="amount" type="number" step="0.01" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><Select label={t("fields.currency")} name="currency" options={[currency, "USD"]} values={[currency, "USD"]} /><Select label={t("fields.category")} name="category" options={[t("categoryOptions.combustible"), t("categoryOptions.ferreteria"), t("categoryOptions.materiales"), t("categoryOptions.herramientas"), t("categoryOptions.transporte"), t("categoryOptions.comidas"), t("categoryOptions.servicios"), t("categoryOptions.honorarios"), t("categoryOptions.otro")]} values={["combustible", "ferreteria", "materiales", "herramientas", "transporte", "comidas", "servicios", "honorarios", "otro"]} /><Select label={t("fields.property")} name="property_id" options={[t("unassignedProperty"), ...properties.map((p) => p.name)]} values={["", ...properties.map((p) => p.id)]} /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label={t("fields.paymentMethod")} name="payment_method" placeholder={t("placeholders.paymentMethod")} /><Field label={t("fields.receiptUrl")} name="receipt_url" type="url" placeholder={t("placeholders.receiptUrl")} /></div>
        <div className="grid gap-2"><Label>{t("fields.description")}</Label><textarea name="description" className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm" placeholder={t("placeholders.description")} /></div>
        <DialogFooter><Button type="submit">{t("submit")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function Field({ label, name, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) { return <div className="grid gap-2"><Label>{label}</Label><Input name={name} {...props} /></div>; }
function Select({ label, name, options, values }: { label: string; name: string; options: string[]; values?: string[] }) { return <div className="grid gap-2"><Label>{label}</Label><select name={name} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">{options.map((option, index) => <option key={option} value={values?.[index] ?? option}>{option}</option>)}</select></div>; }
