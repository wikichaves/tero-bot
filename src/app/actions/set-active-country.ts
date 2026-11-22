"use server";
import { cookies } from "next/headers";
import { z } from "zod";
import { availabilityViewer } from "@/lib/availability/data";
import { getAllowedCountries } from "@/lib/country";
export async function setActiveCountry(country: string) {
  const parsed = z.enum(["AR", "UY", "ALL"]).safeParse(country);
  if (!parsed.success) return { error: "País inválido." };
  const viewer = await availabilityViewer();
  const allowed = await getAllowedCountries(viewer.ids);
  if (!allowed.includes(parsed.data)) return { error: "País no permitido." };
  (await cookies()).set("tero-country", parsed.data, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 31536000 });
  return { ok: true };
}
