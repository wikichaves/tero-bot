import { requireRole } from "@/lib/auth";
import { getActiveCountry, getCountryPropertyIds } from "@/lib/country";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { deleteLead, updateLead } from "./actions";
import { NewLeadDialog } from "./new-lead-dialog";

type LeadRow = { id: string; property_id: string | null; first_name: string; last_name: string | null; phone: string | null; email: string | null; check_in: string | null; check_out: string | null; guest_count: number | null; status: string; follow_up_at: string | null; notes: string | null; property: { name: string } | null };

export default async function LeadsPage() {
  const profile = await requireRole(["admin", "gestor"]);
  const country = await getActiveCountry();
  const ids = await getCountryPropertyIds(country, await getAllowedPropertyIds(profile));
  const db = await createClient();
  const [leadsRes, propsRes] = await Promise.all([db.from("leads").select("*, property:properties(name)").eq("country", country).order("follow_up_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }), db.from("properties").select("id, name").in("id", ids).order("name")]);
  const leads = leadsRes.data ?? []; const properties = propsRes.data ?? [];
  return <div className="grid gap-8"><div><h1 className="text-4xl">Leads</h1><p className="mt-2 text-sm text-muted-foreground">Consultas y huéspedes para volver a contactar cuando haya precio o nueva temporada.</p></div>
    <div className="flex justify-end"><NewLeadDialog properties={properties} /></div>
    <Card><CardHeader><CardTitle>Para seguir</CardTitle><CardDescription>{leads.length ? "Todos los contactos del país activo." : "Todavía no hay contactos cargados."}</CardDescription></CardHeader><CardContent className="space-y-3">{leads.map((lead: LeadRow) => <div key={lead.id} className="border-b border-border/60 pb-3 text-sm"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><strong>{lead.first_name} {lead.last_name ?? ""}</strong><span className="ml-2 text-muted-foreground">{lead.property?.name ?? "Propiedad a definir"} · {lead.status}</span><p className="mt-1 text-muted-foreground">{[lead.phone, lead.email, lead.check_in && "Viaje: " + lead.check_in, lead.guest_count && lead.guest_count + " huéspedes"].filter(Boolean).join(" · ")}</p>{lead.notes && <p className="mt-1">{lead.notes}</p>}</div><div className="text-muted-foreground">{lead.follow_up_at ? "Contactar " + lead.follow_up_at : "Sin fecha"}</div></div><details className="mt-3"><summary className="cursor-pointer text-muted-foreground hover:text-foreground">Editar</summary><form action={updateLead.bind(null, lead.id)} className="mt-3 grid gap-3 rounded-lg bg-muted/40 p-4"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Nombre" name="first_name" defaultValue={lead.first_name} required /><Field label="Apellido" name="last_name" defaultValue={lead.last_name ?? ""} /></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Teléfono" name="phone" defaultValue={lead.phone ?? ""} /><Field label="Email" name="email" defaultValue={lead.email ?? ""} /></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Check-in" name="check_in" type="date" defaultValue={lead.check_in ?? ""} /><Field label="Huéspedes" name="guest_count" type="number" min="1" defaultValue={lead.guest_count?.toString() ?? ""} /></div><div className="grid gap-2"><Label>Notas</Label><textarea name="notes" defaultValue={lead.notes ?? ""} className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm" /></div><div className="flex gap-2"><Button type="submit" size="sm">Guardar cambios</Button><Button formAction={deleteLead.bind(null, lead.id)} type="submit" size="sm" variant="destructive">Eliminar</Button></div></form></details></div>)}</CardContent></Card>
  </div>;
}
function Field({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) { return <div className="grid gap-2"><Label htmlFor={name}>{label}</Label><Input id={name} name={name} {...props} /></div>; }
