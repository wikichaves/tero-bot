"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLead } from "./actions";

type Property = { id: string; name: string };

export function NewLeadDialog({ properties }: { properties: Property[] }) {
  const [open, setOpen] = useState(false);
  async function submit(formData: FormData) { await createLead(formData); setOpen(false); }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button />}>Cargar lead</DialogTrigger>
    <DialogContent className="sm:max-w-2xl">
      <form action={submit} className="grid gap-4">
        <DialogHeader><DialogTitle>Nuevo contacto</DialogTitle><DialogDescription>Guardá lo esencial ahora; el próximo contacto evita que se enfríe la consulta.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="Nombre" name="first_name" required /><Field label="Apellido" name="last_name" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="Teléfono" name="phone" type="tel" /><Field label="Email" name="email" type="email" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><Field label="Check-in estimado" name="check_in" type="date" /><Field label="Check-out estimado" name="check_out" type="date" /><Field label="Huéspedes" name="guest_count" type="number" min="1" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Select label="Propiedad de interés" name="property_id" options={["A definir", ...properties.map((p) => p.name)]} values={["", ...properties.map((p) => p.id)]} /><Field label="Próximo contacto" name="follow_up_at" type="date" /></div>
        <div className="grid gap-2"><Label>Notas</Label><textarea name="notes" className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm" placeholder="Qué busca, presupuesto, cómo llegó." /></div>
        <div><Button type="submit">Guardar lead</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

function Field({ label, name, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) { return <div className="grid gap-2"><Label>{label}</Label><Input name={name} {...props} /></div>; }
function Select({ label, name, options, values }: { label: string; name: string; options: string[]; values?: string[] }) { return <div className="grid gap-2"><Label>{label}</Label><select name={name} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">{options.map((option, index) => <option key={option} value={values?.[index] ?? option}>{option}</option>)}</select></div>; }
