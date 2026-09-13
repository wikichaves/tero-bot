import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { requireRole } from "@/lib/auth";
import { getActiveCountry, getCountryPropertyIds } from "@/lib/country";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";

type PropertyRef = { id: string; name: string; currency: string | null };
type ReservationRow = {
  id: string;
  check_in: string;
  check_out: string;
  guest_name: string | null;
  status: string | null;
  payout_amount: number | string | null;
  payout_currency: string | null;
  property: PropertyRef | PropertyRef[] | null;
};

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("es-UY", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));
}

function add(map: Map<string, number>, currency: string, amount: number) {
  map.set(currency, (map.get(currency) ?? 0) + amount);
}

export default async function EarningsPage() {
  const t = await getTranslations("earningsPage");
  const profile = await requireRole(["admin", "gestor"]);
  const allowedIds = await getAllowedPropertyIds(profile);
  const country = await getActiveCountry(allowedIds);
  const propertyIds = await getCountryPropertyIds(country, allowedIds);
  const db = await createClient();

  const rows: ReservationRow[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    let query = db
      .from("reservations")
      .select(
        "id, check_in, check_out, guest_name, status, payout_amount, payout_currency, property:properties!inner(id, name, currency, country)",
      )
      .neq("status", "cancelled")
      .order("check_in", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (country !== "ALL") query = query.eq("property.country", country);
    if (allowedIds !== null) query = query.in("property_id", propertyIds);

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron cargar las ganancias");
    const page = (data ?? []) as unknown as ReservationRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  const totals = new Map<string, number>();
  const properties = new Map<string, { name: string; totals: Map<string, number>; stays: number }>();
  const months = new Map<string, Map<string, number>>();
  let missingPayout = 0;

  for (const row of rows) {
    const property = Array.isArray(row.property) ? row.property[0] : row.property;
    const amount = row.payout_amount == null ? null : Number(row.payout_amount);
    const currency = row.payout_currency ?? property?.currency ?? null;
    if (amount == null || !Number.isFinite(amount) || !currency) {
      missingPayout += 1;
      continue;
    }
    add(totals, currency, amount);
    const propertyId = property?.id ?? "unknown";
    const propertyEntry = properties.get(propertyId) ?? {
      name: property?.name ?? t("noProperty"),
      totals: new Map<string, number>(),
      stays: 0,
    };
    add(propertyEntry.totals, currency, amount);
    propertyEntry.stays += 1;
    properties.set(propertyId, propertyEntry);
    const month = row.check_in.slice(0, 7);
    const monthEntry = months.get(month) ?? new Map<string, number>();
    add(monthEntry, currency, amount);
    months.set(month, monthEntry);
  }

  const formatTotals = (values: Map<string, number>) =>
    [...values].map(([currency, amount]) => money(amount, currency)).join(" · ") || "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardDescription>{t("cards.total")}</CardDescription></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatTotals(totals)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>{t("cards.paidStays")}</CardDescription></CardHeader>
          <CardContent className="text-2xl font-semibold">{rows.length - missingPayout}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>{t("cards.missingPayout")}</CardDescription></CardHeader>
          <CardContent className="text-2xl font-semibold">{missingPayout}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("byProperty.title")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {[...properties.values()].sort((a, b) => a.name.localeCompare(b.name)).map((item) => (
            <div key={item.name} className="flex items-center justify-between border-b pb-3 last:border-0">
              <div><p className="font-medium">{item.name}</p><p className="text-sm text-muted-foreground">{t("byProperty.stays", { count: item.stays })}</p></div>
              <p className="font-semibold">{formatTotals(item.totals)}</p>
            </div>
          ))}
          {properties.size === 0 && <p className="text-sm text-muted-foreground">{t("byProperty.empty")}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("monthlyHistory.title")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {[...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, values]) => (
            <div key={month} className="flex items-center justify-between border-b pb-3 last:border-0">
              <p className="capitalize">{monthLabel(month)}</p>
              <p className="font-medium">{formatTotals(values)}</p>
            </div>
          ))}
          {months.size === 0 && <p className="text-sm text-muted-foreground">{t("monthlyHistory.empty")}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
