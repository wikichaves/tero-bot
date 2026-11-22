import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export type Country = "AR" | "UY" | "ALL";
export const COUNTRY_NAME: Record<Country, string> = { AR: "Argentina", UY: "Uruguay", ALL: "Todos" };

export async function getAllowedCountries(allowedIds: string[] | null): Promise<Country[]> {
  if (allowedIds === null) return ["UY", "AR", "ALL"];
  if (!allowedIds.length) return [];
  const db = createAdminClient();
  const { data, error } = await db.from("properties").select("country").in("id", allowedIds);
  if (error) throw new Error("Unable to verify country scope");
  const countries: Country[] = (["UY", "AR"] as const).filter(country => (data ?? []).some(p => p.country === country));
  return countries.length > 1 ? [...countries, "ALL"] : countries;
}

export async function getActiveCountry(allowedIds: string[] | null = null): Promise<Country> {
  const saved = (await cookies()).get("tero-country")?.value;
  const allowed = await getAllowedCountries(allowedIds);
  return allowed.find(country => country === saved) ?? allowed[0] ?? "UY";
}

export async function getCountryPropertyIds(country: Country, allowedIds: string[] | null): Promise<string[]> {
  const db = createAdminClient();
  let query = db.from("properties").select("id");
  if (country !== "ALL") query = query.eq("country", country);
  if (allowedIds !== null) query = query.in("id", allowedIds);
  const { data } = await query;
  return (data ?? []).map((row) => row.id);
}
