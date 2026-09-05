import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export type Country = "AR" | "UY" | "ALL";
export const COUNTRY_NAME: Record<Country, string> = { AR: "Argentina", UY: "Uruguay", ALL: "Todos" };

export async function getActiveCountry(allowedIds: string[] | null = null): Promise<Country> {
  const saved = (await cookies()).get("tero-country")?.value;
  if (saved === "AR" || saved === "UY" || saved === "ALL") return saved;
  if (allowedIds !== null) {
    const db = createAdminClient();
    const { data } = await db.from("properties").select("country").in("id", allowedIds);
    const countries = new Set((data ?? []).map((property) => property.country));
    if (countries.size === 1 && countries.has("AR")) return "AR";
  }
  return "UY";
}

export async function getCountryPropertyIds(country: Country, allowedIds: string[] | null): Promise<string[]> {
  const db = createAdminClient();
  let query = db.from("properties").select("id");
  if (country !== "ALL") query = query.eq("country", country);
  if (allowedIds !== null) query = query.in("id", allowedIds);
  const { data } = await query;
  return (data ?? []).map((row) => row.id);
}
