"use client";

import { useState, type InputHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLead } from "./actions";

type Property = { id: string; name: string };

export function NewLeadDialog({ properties }: { properties: Property[] }) {
  const t = useTranslations("newLeadDialog");
  const [open, setOpen] = useState(false);
  async function submit(formData: FormData) { await createLead(formData); setOpen(false); }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button />}>{t("trigger")}</DialogTrigger>
    <DialogContent>
      <form action={submit} className="grid gap-4">
        <DialogHeader><DialogTitle>{t("title")}</DialogTitle><DialogDescription>{t("description")}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label={t("fields.firstName")} name="first_name" required /><Field label={t("fields.lastName")} name="last_name" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label={t("fields.phone")} name="phone" type="tel" /><Field label={t("fields.email")} name="email" type="email" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><Field label={t("fields.checkIn")} name="check_in" type="date" /><Field label={t("fields.checkOut")} name="check_out" type="date" /><Field label={t("fields.guests")} name="guest_count" type="number" min="1" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Select label={t("fields.property")} name="property_id" options={[t("undecidedProperty"), ...properties.map((p) => p.name)]} values={["", ...properties.map((p) => p.id)]} /><Field label={t("fields.followUp")} name="follow_up_at" type="date" /></div>
        <div className="grid gap-2"><Label>{t("fields.notes")}</Label><textarea name="notes" className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm" placeholder={t("notesPlaceholder")} /></div>
        <DialogFooter><Button type="submit">{t("submit")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function Field({ label, name, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) { return <div className="grid gap-2"><Label>{label}</Label><Input name={name} {...props} /></div>; }
function Select({ label, name, options, values }: { label: string; name: string; options: string[]; values?: string[] }) { return <div className="grid gap-2"><Label>{label}</Label><select name={name} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">{options.map((option, index) => <option key={option} value={values?.[index] ?? option}>{option}</option>)}</select></div>; }
