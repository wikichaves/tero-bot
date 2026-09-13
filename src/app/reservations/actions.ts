"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { getActiveCountry } from "@/lib/country";
import { createAdminClient } from "@/lib/supabase/admin";
import { manualIdentity, manualReservationSchema } from "@/lib/reservations/manual";

export async function createManualReservation(input: Record<string, string>) {
  const profile = await requireRole(["admin", "gestor"]);
  const t = await getTranslations("reservationsPage");
  const parsed = manualReservationSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalid") };
  const value = parsed.data;
  const allowed = await getAllowedPropertyIds(profile);
  if (allowed !== null && !allowed.includes(value.property_id)) return { error: t("notAllowed") };
  const country = await getActiveCountry(allowed);
  const db = createAdminClient();
  const { data: property, error: propertyError } = await db.from("properties").select("id,country").eq("id", value.property_id).maybeSingle();
  if (propertyError || !property || (country !== "ALL" && property.country !== country)) return { error: t("notAllowed") };

  // A stable key uses the existing unique(source, external_id) constraint to
  // make simultaneous/retried submissions idempotent, not just a disabled button.
  const externalId = `manual-ui-${createHash("sha256").update(manualIdentity(value)).digest("hex")}`;
  const { data: existing, error: existingError } = await db.from("reservations").select("id").eq("source", "manual").eq("external_id", externalId).maybeSingle();
  if (existingError) return { error: t("saveError") };
  if (existing) return { id: existing.id, duplicate: true };

  // Catch legacy manual entries (e.g. Hernán) and Airbnb overlaps too. The
  // checkout boundary is exclusive, so adjacent stays remain possible.
  const { data: overlaps, error: overlapError } = await db.from("reservations").select("id").eq("property_id", value.property_id).neq("status", "cancelled").lt("check_in", value.check_out).gt("check_out", value.check_in).limit(1);
  if (overlapError) return { error: t("saveError") };
  if (overlaps?.length) return { error: t("overlap") };

  const { data, error } = await db.from("reservations").insert({
    property_id: value.property_id,
    source: "manual",
    external_id: externalId,
    status: "confirmed",
    guest_name: value.guest_name,
    guest_phone: value.guest_phone || null,
    check_in: value.check_in,
    check_out: value.check_out,
    guest_count: value.guest_count === "" ? null : value.guest_count,
    payout_amount: value.payout_amount === "" ? null : value.payout_amount,
    payout_currency: value.payout_amount === "" ? null : value.payout_currency,
    notes: value.notes || null,
  }).select("id").single();
  if (error?.code === "23505") {
    const { data: retry } = await db.from("reservations").select("id").eq("source", "manual").eq("external_id", externalId).maybeSingle();
    if (retry) return { id: retry.id, duplicate: true };
  }
  if (error || !data) return { error: t("saveError") };
  revalidatePath("/reservations");
  revalidatePath("/dashboard");
  revalidatePath("/earnings");
  return { id: data.id as string, duplicate: false };
}
