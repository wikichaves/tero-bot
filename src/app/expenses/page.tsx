import { requireRole } from "@/lib/auth";
import { getActiveCountry, getCountryPropertyIds } from "@/lib/country";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { deleteExpense, updateExpense } from "./actions";
import { NewExpenseDialog } from "./new-expense-dialog";

type ExpenseRow = { id: string; vendor: string | null; category: string; expense_date: string; description: string | null; amount: number | string | null; currency: string; receipt_url: string | null };

export default async function ExpensesPage() {
  const profile = await requireRole(["admin", "gestor"]);
  const allowedIds = await getAllowedPropertyIds(profile);
  const country = await getActiveCountry(allowedIds);
  const propertyIds = await getCountryPropertyIds(country, allowedIds);
  const db = await createClient();
  let expensesQuery = db.from("expenses").select("*, property:properties(name)");
  if (country !== "ALL") expensesQuery = expensesQuery.eq("country", country);
  if (allowedIds !== null) expensesQuery = expensesQuery.in("property_id", propertyIds);
  const [expensesRes, propertiesRes] = await Promise.all([
    expensesQuery.order("expense_date", { ascending: false }).limit(100),
    db.from("properties").select("id, name, currency").in("id", propertyIds).order("name"),
  ]);
  const expenses = expensesRes.data ?? [];
  const properties = propertiesRes.data ?? [];
  const currency = country === "AR" ? "ARS" : "UYU";
  return <div className="grid gap-8">
    <div><h1 className="text-4xl">Gastos</h1><p className="mt-2 text-sm text-muted-foreground">Compras puntuales para rendir a Casa Bosque Montoya SAS: nafta, ferretería, insumos y más.</p></div>
    <div className="flex justify-end"><NewExpenseDialog properties={properties} currency={currency} /></div>
    <Card><CardHeader><CardTitle>Últimos gastos</CardTitle><CardDescription>{expenses.length ? "Pendientes de revisión o ya registrados." : "Todavía no hay gastos en este país."}</CardDescription></CardHeader><CardContent className="space-y-3">{expenses.map((e: ExpenseRow) => <div key={e.id} className="border-b border-border/60 pb-3 text-sm"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><strong>{e.vendor ?? "Sin comercio"}</strong><span className="ml-2 text-muted-foreground">{e.category} · {e.expense_date}</span>{e.description && <p className="mt-1 text-muted-foreground">{e.description}</p>}{e.receipt_url && <a href={e.receipt_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-10 items-center text-sm font-medium underline underline-offset-4 hover:text-foreground">Ver foto del ticket</a>}</div><div className="font-medium tabular-nums">{e.amount != null ? e.currency + " " + Number(e.amount).toLocaleString("es-UY", { minimumFractionDigits: 2 }) : "Sin importe"}</div></div><details className="mt-3"><summary className="cursor-pointer text-muted-foreground hover:text-foreground">Editar</summary><form action={updateExpense.bind(null, e.id)} className="mt-3 grid gap-3 rounded-lg bg-muted/40 p-4"><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Field label="Fecha" name="expense_date" type="date" defaultValue={e.expense_date} /><Field label="Comercio" name="vendor" defaultValue={e.vendor ?? ""} /><Field label="Importe" name="amount" type="number" step="0.01" defaultValue={e.amount?.toString() ?? ""} /></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Select label="Moneda" name="currency" options={[e.currency, "USD"]} /><Select label="Categoría" name="category" options={["combustible", "ferreteria", "materiales", "herramientas", "transporte", "comidas", "servicios", "honorarios", "otro"]} /></div><div className="grid gap-2"><Label>Descripción</Label><textarea name="description" defaultValue={e.description ?? ""} className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm" /></div><div className="flex gap-2"><Button type="submit" size="sm">Guardar cambios</Button><Button formAction={deleteExpense.bind(null, e.id)} type="submit" size="sm" variant="destructive">Eliminar</Button></div></form></details></div>)}</CardContent></Card>
  </div>;
}
function Field({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) { return <div className="grid gap-2"><Label htmlFor={name}>{label}</Label><Input id={name} name={name} {...props} /></div>; }
function Select({ label, name, options, values }: { label: string; name: string; options: string[]; values?: string[] }) { return <div className="grid gap-2"><Label htmlFor={name}>{label}</Label><select id={name} name={name} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">{options.map((option, index) => <option key={option} value={values?.[index] ?? option}>{option}</option>)}</select></div>; }
