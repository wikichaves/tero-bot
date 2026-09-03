import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export type Country = "AR" | "UY";
export const COUNTRY_NAME: Record<Country, string> = { AR: "Argentina", UY: "Uruguay" };

export async function getActiveCountry(): Promise<Country> {
  return (await cookies()).get("tero-country")?.value === "AR" ? "AR" : "UY";
}

export async function getCountryPropertyIds(country: Country, allowedIds: string[] | null): Promise<string[]> {
  const db = createAdminClient();
  let query = db.from("properties").select("id").eq("country", country);
  if (allowedIds !== null) query = query.in("id", allowedIds);
  const { data } = await query;
  return (data ?? []).map((row) => row.id);
}
