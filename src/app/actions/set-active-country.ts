"use server";
import { cookies } from "next/headers";
import { z } from "zod";
export async function setActiveCountry(country: string) {
  const parsed = z.enum(["AR", "UY"]).safeParse(country);
  if (!parsed.success) return { error: "País inválido." };
  (await cookies()).set("tero-country", parsed.data, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 31536000 });
  return { ok: true };
}
