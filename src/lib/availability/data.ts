import "server-only";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { monthDays, type Busy } from "./core";

export async function availabilityViewer() {
  const user = await requireUser();
  const db = await createClient();
  const { data: profile, error } = await db.from("profiles").select("id,role").eq("id", user.id).single();
  if (error || !profile) throw new Error("Unable to verify access");
  if (profile.role === "admin") return { admin: true, ids: null };
  if (profile.role !== "agency") redirect("/dashboard");
  const service = createAdminClient();
  const { data: agency, error: ae } = await service.from("agencies").select("active").eq("profile_id", user.id).maybeSingle();
  if (ae) throw new Error("Unable to verify access");
  if (!agency?.active) return { admin: false, ids: [] as string[] };
  const { data, error: pe } = await service.from("agency_properties").select("property_id").eq("profile_id", user.id);
  if (pe) throw new Error("Unable to verify access");
  return { admin: false, ids: (data ?? []).map(p => p.property_id as string) };
}
export async function loadAvailability(month: string) {
  const viewer = await availabilityViewer();
  const days = monthDays(month);
  const end = new Date(`${days.at(-1)}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
  const until = end.toISOString().slice(0,10);
  const db = createAdminClient();
  let query = db.from("properties").select("id,name,country,airbnb_ical_url,booking_ical_url").eq("is_rental",true).order("sort_order");
  if (viewer.ids !== null) query = query.in("id",viewer.ids);
  const { data: properties, error } = await query;
  if (error) throw new Error("Availability unavailable");
  const ids = (properties ?? []).map(p => p.id);
  const [manual, blocks, imported, rates, sync] = await Promise.all([
    db.from("reservations").select("id,property_id,check_in,check_out").in("property_id",ids).neq("status","cancelled").lt("check_in",until).gt("check_out",days[0]),
    db.from("availability_blocks").select("id,property_id,start_date,end_date").in("property_id",ids).lt("start_date",until).gt("end_date",days[0]),
    db.from("availability_imports").select("uid,property_id,start_date,end_date,kind").in("property_id",ids).lt("start_date",until).gt("end_date",days[0]),
    db.from("seasonal_rates").select("id,property_id,start_date,end_date,amount,currency").in("property_id",ids).lt("start_date",until).gt("end_date",days[0]),
    db.from("availability_sync").select("property_id,last_success_at,failed,source_hash").in("property_id",ids),
  ]);
  if ([manual, blocks, imported, rates, sync].some(r => r.error || (r.data?.length ?? 0) >= 1000)) throw new Error("Availability unavailable");
  const busy: Busy[] = [
    ...(manual.data ?? []).map(r => ({ id:r.id, property_id:r.property_id, start_date:r.check_in, end_date:r.check_out, kind:"reservation" as const })),
    ...(blocks.data ?? []).map(r => ({ ...r, kind:"block" as const })),
    ...(imported.data ?? []).map(r => ({ id:r.uid, property_id:r.property_id, start_date:r.start_date,end_date:r.end_date,kind:r.kind as Busy["kind"] })),
  ];
  return { viewer, days, busy, rates: rates.data ?? [], properties: (properties ?? []).map(p => {
    const state = sync.data?.find(s => s.property_id===p.id);
    const fresh = !!state?.last_success_at && Date.now()-Date.parse(state.last_success_at)<6*3600000;
    const hashMatches = p.airbnb_ical_url && state?.source_hash === createHash("sha256").update(p.airbnb_ical_url).digest("hex");
    return { id:p.id as string, name:p.name as string, country:p.country as string, lastSync:state?.last_success_at as string | null, known: !p.booking_ical_url && (!p.airbnb_ical_url || (!!fresh && !!hashMatches && !state?.failed)) };
  }) };
}
