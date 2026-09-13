import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  enrichWithEffectivePeriod,
  type BillRow,
} from "@/lib/bills/enrich-period";
import { computeTuyaConsumption } from "@/lib/bills/tuya-comparison";
import { createAdminClient } from "@/lib/supabase/admin";
import { timingSafeEqual } from "@/lib/telegram";
import type { Property } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  action: z.enum([
    "properties",
    "utility_spend",
    "bills_due",
    "energy_consumption",
    "reservations",
    "earnings",
  ]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  property: z.string().trim().min(1).optional(),
  utility: z.enum(["luz", "agua", "internet", "alarma", "otro"]).optional(),
  date_basis: z.enum(["service_period", "issue_date", "due_date"]).optional(),
});
type Query = z.infer<typeof schema>;
type PropertySummary = Pick<Property, "id" | "name" | "currency">;
type ReservationQueryRow = {
  id: string;
  guest_name: string | null;
  check_in: string;
  check_out: string;
  source: string | null;
  status: string | null;
  payout_amount: number | string | null;
  payout_currency: string | null;
  property: PropertySummary | PropertySummary[] | null;
};

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isAuthorized(request: NextRequest) {
  const configured = process.env.TERO_CACHA_READ_TOKEN;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(configured && provided && timingSafeEqual(provided, configured));
}

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

function monthRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function resolveProperty(properties: PropertySummary[], requested?: string) {
  if (!requested) return { property: null, error: null };
  const needle = normalized(requested);
  const exact = properties.find((item) => normalized(item.name) === needle);
  if (exact) return { property: exact, error: null };
  const matches = properties.filter((item) => normalized(item.name).includes(needle));
  if (matches.length === 1) return { property: matches[0], error: null };
  return {
    property: null,
    error: {
      error: matches.length ? "Ambiguous property" : "Property not found",
      candidates: (matches.length ? matches : properties).map((item) => item.name),
    },
  };
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return reply({ error: "Unauthorized" }, 401);

  let query: Query;
  try {
    query = schema.parse(await request.json());
  } catch (error) {
    return reply(
      {
        error: "Invalid query",
        details: error instanceof z.ZodError ? error.flatten() : undefined,
      },
      400,
    );
  }

  const defaults = query.action === "earnings"
    ? { from: "2000-01-01", to: new Date().toISOString().slice(0, 10) }
    : monthRange();
  const range = {
    from: query.from ?? defaults.from,
    to: query.to ?? defaults.to,
  };
  const fromTime = Date.parse(`${range.from}T00:00:00Z`);
  const toTime = Date.parse(`${range.to}T00:00:00Z`);
  const days = (toTime - fromTime) / 86_400_000;
  const maxDays = query.action === "earnings" ? 20_000 : 370;
  if (!Number.isFinite(days) || days < 0 || days > maxDays) {
    return reply({ error: `Date range must be between 0 and ${maxDays} days` }, 400);
  }

  const admin = createAdminClient();
  const { data: propertyRows, error: propertyError } = await admin
    .from("properties")
    .select("id, name, currency")
    .order("sort_order", { ascending: true });
  if (propertyError) return reply({ error: "Could not load properties" }, 500);
  const properties = (propertyRows ?? []) as PropertySummary[];
  if (query.action === "properties") return reply({ properties });

  const resolved = resolveProperty(properties, query.property);
  if (resolved.error) return reply(resolved.error, 404);
  const property = resolved.property;

  if (query.action === "reservations" || query.action === "earnings") {
    const reservationRows: ReservationQueryRow[] = [];
    const pageSize = 1_000;
    for (let offset = 0; ; offset += pageSize) {
      let reservationsQuery = admin
        .from("reservations")
        .select(
          "id, guest_name, check_in, check_out, source, status, payout_amount, payout_currency, property:properties(id, name, currency)",
        )
        .neq("status", "cancelled")
        .order("check_in", { ascending: query.action === "earnings" })
        .range(offset, offset + pageSize - 1);
      reservationsQuery = query.action === "earnings"
        ? reservationsQuery.gte("check_in", range.from).lte("check_in", range.to)
        : reservationsQuery.lte("check_in", range.to).gt("check_out", range.from);
      if (property) reservationsQuery = reservationsQuery.eq("property_id", property.id);

      const { data, error: reservationsError } = await reservationsQuery;
      if (reservationsError) {
        return reply({ error: "Could not load reservations" }, 500);
      }
      const page = (data ?? []) as unknown as ReservationQueryRow[];
      reservationRows.push(...page);
      if (page.length < pageSize) break;
    }

    const reservations = reservationRows.map((row) => {
      const related = Array.isArray(row.property) ? row.property[0] : row.property;
      return {
        id: row.id,
        property: related?.name ?? null,
        guest_name: row.guest_name,
        check_in: row.check_in,
        check_out: row.check_out,
        source: row.source,
        status: row.status,
        payout_amount: row.payout_amount == null ? null : Number(row.payout_amount),
        payout_currency: row.payout_currency ?? related?.currency ?? null,
      };
    });

    if (query.action === "reservations") {
      return reply({
        action: query.action,
        period: range,
        filters: { property: property?.name ?? null },
        reservation_count: reservations.length,
        reservations,
      });
    }

    const totals = new Map<string, number>();
    const byProperty = new Map<string, Map<string, number>>();
    const byMonth = new Map<string, Map<string, number>>();
    let missingPayout = 0;
    for (const reservation of reservations) {
      if (reservation.payout_amount == null || !reservation.payout_currency) {
        missingPayout += 1;
        continue;
      }
      const currency = reservation.payout_currency;
      totals.set(currency, (totals.get(currency) ?? 0) + reservation.payout_amount);
      const propertyName = reservation.property ?? "Sin propiedad";
      const propertyTotals = byProperty.get(propertyName) ?? new Map<string, number>();
      propertyTotals.set(
        currency,
        (propertyTotals.get(currency) ?? 0) + reservation.payout_amount,
      );
      byProperty.set(propertyName, propertyTotals);
      const month = reservation.check_in.slice(0, 7);
      const monthTotals = byMonth.get(month) ?? new Map<string, number>();
      monthTotals.set(currency, (monthTotals.get(currency) ?? 0) + reservation.payout_amount);
      byMonth.set(month, monthTotals);
    }

    return reply({
      action: query.action,
      period: range,
      filters: { property: property?.name ?? null },
      reservation_count: reservations.length,
      reservations_with_payout: reservations.length - missingPayout,
      reservations_missing_payout: missingPayout,
      totals: Object.fromEntries(totals),
      by_property: Object.fromEntries(
        [...byProperty].map(([name, values]) => [name, Object.fromEntries(values)]),
      ),
      by_month: Object.fromEntries(
        [...byMonth].map(([month, values]) => [month, Object.fromEntries(values)]),
      ),
    });
  }

  if (query.action === "energy_consumption") {
    if (!property) {
      return reply({ error: "property is required for energy_consumption" }, 400);
    }
    const consumption = await computeTuyaConsumption(
      admin,
      property.id,
      range.from,
      range.to,
    );
    return reply({
      action: query.action,
      period: range,
      property,
      unit: "kWh",
      consumption,
    });
  }

  let dbQuery = admin
    .from("utility_bills")
    .select("*, property:properties(id, name, currency)")
    .neq("status", "cancelled");
  if (property) dbQuery = dbQuery.eq("property_id", property.id);
  if (query.utility) dbQuery = dbQuery.eq("utility_type", query.utility);
  const { data: rows, error: billsError } = await dbQuery;
  if (billsError) return reply({ error: "Could not load utility bills" }, 500);

  const bills = enrichWithEffectivePeriod((rows ?? []) as BillRow[]);
  const selected = bills.filter((bill) => {
    if (query.action === "bills_due") {
      return Boolean(
        bill.due_date &&
          bill.due_date >= range.from &&
          bill.due_date <= range.to &&
          bill.status !== "paid",
      );
    }
    const basis = query.date_basis ?? "service_period";
    if (basis === "issue_date") {
      return Boolean(
        bill.issue_date &&
          bill.issue_date >= range.from &&
          bill.issue_date <= range.to,
      );
    }
    if (basis === "due_date") {
      return Boolean(
        bill.due_date &&
          bill.due_date >= range.from &&
          bill.due_date <= range.to,
      );
    }
    return Boolean(
      bill.effective_period_from &&
        bill.effective_period_to &&
        bill.effective_period_from <= range.to &&
        bill.effective_period_to >= range.from,
    );
  });

  if (query.action === "bills_due") {
    return reply({
      action: query.action,
      period: range,
      filters: { property: property?.name ?? null, utility: query.utility ?? null },
      bills: selected.map((bill) => ({
        id: bill.id,
        property: bill.property?.name ?? null,
        utility: bill.utility_type,
        provider: bill.provider,
        amount: bill.amount,
        currency: bill.currency ?? bill.property?.currency ?? "UYU",
        due_date: bill.due_date,
        status: bill.status,
      })),
    });
  }

  const totals = new Map<string, number>();
  const byProperty = new Map<string, Map<string, number>>();
  for (const bill of selected) {
    if (bill.amount == null) continue;
    const currency = bill.currency ?? bill.property?.currency ?? "UYU";
    totals.set(currency, (totals.get(currency) ?? 0) + Number(bill.amount));
    const name = bill.property?.name ?? "Sin propiedad";
    const values = byProperty.get(name) ?? new Map<string, number>();
    values.set(currency, (values.get(currency) ?? 0) + Number(bill.amount));
    byProperty.set(name, values);
  }

  return reply({
    action: query.action,
    period: range,
    date_basis: query.date_basis ?? "service_period",
    filters: { property: property?.name ?? null, utility: query.utility ?? null },
    bill_count: selected.length,
    totals: Object.fromEntries(totals),
    by_property: Object.fromEntries(
      [...byProperty].map(([name, values]) => [name, Object.fromEntries(values)]),
    ),
  });
}
