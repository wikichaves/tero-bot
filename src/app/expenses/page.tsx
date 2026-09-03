import { requireRole } from "@/lib/auth";
import { getActiveCountry, getCountryPropertyIds } from "@/lib/country";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createExpense } from "./actions";

type ExpenseRow = { id: string; vendor: string | null; category: string; expense_date: string; description: string | null; amount: number | string | null; currency: string };

export default async function ExpensesPage() {
  const profile = await requireRole(["admin", "gestor"]);
  const country = await getActiveCountry();
  const propertyIds = await getCountryPropertyIds(country, await getAllowedPropertyIds(profile));
  const db = await createClient();
  const [expensesRes, propertiesRes] = await Promise.all([
    db.from("expenses").select("*, property:properties(name)").eq("country", country).order("expense_date", { ascending: false }).limit(100),
    db.from("properties").select("id, name, currency").in("id", propertyIds).order("name"),
  ]);
  const expenses = expensesRes.data ?? [];
  const properties = propertiesRes.data ?? [];
  const currency = country === "AR" ? "ARS" : "UYU";
  return <div className="grid gap-8">
    <div><h1 className="text-4xl">Gastos</h1><p className="mt-2 text-sm text-muted-foreground">Compras puntuales para rendir a Casa Bosque Montoya SAS: nafta, ferretería, insumos y más.</p></div>
    <Card><CardHeader><CardTitle>Cargar gasto</CardTitle><CardDescription>Mandale una foto del ticket al WhatsApp de tero.bot y aparece acá para revisar.</CardDescription></CardHeader><CardContent>
      <form action={createExpense} className="grid gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><Field label="Fecha" name="expense_date" type="date" /><Field label="Comercio" name="vendor" placeholder="Ej. ANCAP" /><Field label="Importe" name="amount" type="number" step="0.01" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><Select label="Moneda" name="currency" options={[currency, "USD"]} /><Select label="Categoría" name="category" options={["combustible", "ferreteria", "materiales", "herramientas", "transporte", "comidas", "servicios", "honorarios", "otro"]} /><Select label="Propiedad" name="property_id" options={["Sin asignar", ...properties.map((p) => p.name)]} values={["", ...properties.map((p) => p.id)]} /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="Medio de pago" name="payment_method" placeholder="Efectivo, tarjeta…" /><Field label="Link de foto/ticket" name="receipt_url" type="url" placeholder="Opcional" /></div>
        <div className="grid gap-2"><Label htmlFor="description">Descripción</Label><textarea id="description" name="description" className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm" placeholder="Qué se compró y para qué." /></div>
        <div><Button type="submit">Guardar gasto</Button></div>
      </form>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Últimos gastos</CardTitle><CardDescription>{expenses.length ? "Pendientes de revisión o ya registrados." : "Todavía no hay gastos en este país."}</CardDescription></CardHeader><CardContent className="space-y-3">{expenses.map((e: ExpenseRow) => <div key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3 text-sm"><div><strong>{e.vendor ?? "Sin comercio"}</strong><span className="ml-2 text-muted-foreground">{e.category} · {e.expense_date}</span>{e.description && <p className="mt-1 text-muted-foreground">{e.description}</p>}</div><div className="font-medium tabular-nums">{e.amount != null ? e.currency + " " + Number(e.amount).toLocaleString("es-UY", { minimumFractionDigits: 2 }) : "Sin importe"}</div></div>)}</CardContent></Card>
  </div>;
}
function Field({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) { return <div className="grid gap-2"><Label htmlFor={name}>{label}</Label><Input id={name} name={name} {...props} /></div>; }
function Select({ label, name, options, values }: { label: string; name: string; options: string[]; values?: string[] }) { return <div className="grid gap-2"><Label htmlFor={name}>{label}</Label><select id={name} name={name} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">{options.map((option, index) => <option key={option} value={values?.[index] ?? option}>{option}</option>)}</select></div>; }
