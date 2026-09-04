"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createExpense } from "./actions";

type Property = { id: string; name: string };

export function NewExpenseDialog({ properties, currency }: { properties: Property[]; currency: string }) {
  const [open, setOpen] = useState(false);
  async function submit(formData: FormData) { await createExpense(formData); setOpen(false); }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button />}>Cargar gasto</DialogTrigger>
    <DialogContent className="sm:max-w-2xl">
      <form action={submit} className="grid gap-4">
        <DialogHeader><DialogTitle>Cargar gasto</DialogTitle><DialogDescription>Mandale una foto del ticket al WhatsApp de tero.bot y aparece acá para revisar.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><Field label="Fecha" name="expense_date" type="date" /><Field label="Comercio" name="vendor" placeholder="Ej. ANCAP" /><Field label="Importe" name="amount" type="number" step="0.01" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><Select label="Moneda" name="currency" options={[currency, "USD"]} /><Select label="Categoría" name="category" options={["combustible", "ferreteria", "materiales", "herramientas", "transporte", "comidas", "servicios", "honorarios", "otro"]} /><Select label="Propiedad" name="property_id" options={["Sin asignar", ...properties.map((p) => p.name)]} values={["", ...properties.map((p) => p.id)]} /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="Medio de pago" name="payment_method" placeholder="Efectivo, tarjeta" /><Field label="Link de foto/ticket" name="receipt_url" type="url" placeholder="Opcional" /></div>
        <div className="grid gap-2"><Label>Descripción</Label><textarea name="description" className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm" placeholder="Qué se compró y para qué." /></div>
        <div><Button type="submit">Guardar gasto</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

function Field({ label, name, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) { return <div className="grid gap-2"><Label>{label}</Label><Input name={name} {...props} /></div>; }
function Select({ label, name, options, values }: { label: string; name: string; options: string[]; values?: string[] }) { return <div className="grid gap-2"><Label>{label}</Label><select name={name} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">{options.map((option, index) => <option key={option} value={values?.[index] ?? option}>{option}</option>)}</select></div>; }
