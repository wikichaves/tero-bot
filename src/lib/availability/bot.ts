import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { overlaps } from "./core";
import { freeRanges, normalize, parseAvailabilityQuery } from "./query";

export const availabilityHelp = "Consultá /disponibilidad para todas tus casas, /disponibilidad Casa Merced para una casa o escribí: busco casa para 4 personas del 01/01/2027 al 08/01/2027.\nhttps://tero.bot/availability";

// Re-resolve the role and active grants on every request. Never trust a cached role.
export async function availabilityReply(profileId: string, text: string): Promise<string> {
  const db = createAdminClient();
  const {data: profile, error: pe} = await db.from("profiles").select("role").eq("id",profileId).single();
  if (pe || !profile || !["admin","gestor","agency"].includes(profile.role)) return "No tenés acceso a consultas de inmobiliaria.";
  let ids: string[] | null = null;
  if (profile.role === "agency") {
    const {data: agency,error} = await db.from("agencies").select("active").eq("profile_id",profileId).maybeSingle();
    if (error) throw new Error("Unable to verify agency");
    if (!agency?.active) return "Tu acceso de inmobiliaria no está activo.";
    const grants = await db.from("agency_properties").select("property_id").eq("profile_id",profileId);
    if (grants.error) throw new Error("Unable to verify grants");
    ids = (grants.data ?? []).map(p=>p.property_id);
    if (!ids.length) return "No tenés casas asignadas.";
  }
  if (profile.role === "gestor") {
    const grants = await db.from("profile_properties").select("property_id").eq("profile_id",profileId);
    if (grants.error) throw new Error("Unable to verify manager grants");
    ids = (grants.data ?? []).map(p=>p.property_id);
    if (!ids.length) return "No tenés casas asignadas.";
  }
  const query = parseAvailabilityQuery(text);
  if (query.error) return "Indicá entrada y salida con año (DD/MM/AAAA), hasta 366 noches. Ejemplo: /disponibilidad Casa Merced 01/01/2027 08/01/2027";
  let propertiesQuery = db.from("properties").select("id,name,max_guests,airbnb_ical_url,booking_ical_url").eq("is_rental",true).order("sort_order");
  if (ids !== null) propertiesQuery = propertiesQuery.in("id",ids);
  const result = await propertiesQuery;
  if (result.error) throw new Error("Unable to load properties");
  const properties = (result.data ?? []).filter(p=>!query.filter || normalize(p.name).includes(query.filter));
  if (!properties.length) return "No encontré esa casa entre tus propiedades autorizadas.";
  const candidates = properties.filter(p=>query.guests === null || p.max_guests === null || p.max_guests >= query.guests);
  if (!candidates.length) return `No hay una casa asignada con capacidad confirmada para ${query.guests} personas. Podés consultar por un grupo más chico; no sumo casas automáticamente.`;
  if (query.guests !== null && !query.start) {
    return `Opciones por capacidad para ${query.guests} personas (todavía sin verificar fechas):\n` + candidates.map(p=>`• ${p.name}: ${p.max_guests === null ? "capacidad por confirmar" : `hasta ${p.max_guests} personas`}`).join("\n") + `\n\n¿Para qué fechas? Indicá entrada y salida así:\n/disponibilidad ${query.filter} ${query.guests} personas 01/01/2027 08/01/2027`;
  }
  const today = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Montevideo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const start = query.start ?? today;
  const later = new Date(`${start}T00:00:00Z`); later.setUTCDate(later.getUTCDate()+30);
  const end = query.end ?? later.toISOString().slice(0,10);
  const days: string[] = [];
  for (const d=new Date(`${start}T00:00:00Z`); d.toISOString().slice(0,10)<end; d.setUTCDate(d.getUTCDate()+1)) days.push(d.toISOString().slice(0,10));
  const selectedIds=candidates.map(p=>p.id);
  const [reservations,blocks,imports,sync] = await Promise.all([
    db.from("reservations").select("property_id,check_in,check_out").in("property_id",selectedIds).neq("status","cancelled").lt("check_in",end).gt("check_out",start),
    db.from("availability_blocks").select("property_id,start_date,end_date").in("property_id",selectedIds).lt("start_date",end).gt("end_date",start),
    db.from("availability_imports").select("property_id,start_date,end_date").in("property_id",selectedIds).lt("start_date",end).gt("end_date",start),
    db.from("availability_sync").select("property_id,last_success_at,failed,source_hash").in("property_id",selectedIds),
  ]);
  if ([reservations,blocks,imports,sync].some(r=>r.error || (r.data?.length ?? 0)>=1000)) throw new Error("Unable to load availability");
  const busy=[...(reservations.data??[]).map(r=>({property_id:r.property_id,start_date:r.check_in,end_date:r.check_out})),...(blocks.data??[]),...(imports.data??[])];
  const fmt=(d:string)=>d.split("-").reverse().join("/");
  const lines=candidates.map(p=>{
    const state=sync.data?.find(s=>s.property_id===p.id);
    const fresh=!!state?.last_success_at && Date.now()-Date.parse(state.last_success_at)<6*3600000;
    const hash=p.airbnb_ical_url && state?.source_hash===createHash("sha256").update(p.airbnb_ical_url).digest("hex");
    const known=!p.booking_ical_url && !!p.airbnb_ical_url && fresh && hash && !state?.failed;
    const occupied=new Set(days.filter(day=>busy.some(b=>b.property_id===p.id && overlaps(b.start_date,b.end_date,day))));
    const capacity=query.guests!==null && p.max_guests===null ? " · capacidad por confirmar" : "";
    if (query.start && occupied.size) return `• ${p.name}: no disponible para toda la estadía${capacity}`;
    if (!known) return `• ${p.name}: disponibilidad sin confirmar (sin sincronización vigente)${capacity}`;
    if (query.start) return `• ${p.name}: ${capacity ? "sin bloqueos registrados" : "disponible"}${capacity}`;
    const ranges=freeRanges(days,occupied);
    return `• ${p.name}: ${ranges.length ? ranges.slice(0,5).map(r=>`${fmt(r.start)} → ${fmt(r.end)}`).join(", ") + (ranges.length>5?" (más fechas en calendario)":"") : "sin noches libres"}`;
  });
  return `Disponibilidad · ${fmt(start)} → ${fmt(end)}\n${query.start ? "" : "Rangos libres; la última fecha es la salida.\n"}${lines.join("\n")}\n\nhttps://tero.bot/availability`;
}
