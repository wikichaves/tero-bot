import { daySchema, overlaps, type Busy } from "@/lib/availability/core";
type Rate = {property_id: string; start_date: string; end_date: string; amount: number | string; currency: string};
export function validStay(arrival: string, departure: string) {
  return daySchema.safeParse(arrival).success && daySchema.safeParse(departure).success && arrival < departure && arrival >= "2000-01-01" && departure <= "2200-12-31" && Date.parse(departure)-Date.parse(arrival) <= 330*86400000;
}
export function staySummary(property: {id: string; known: boolean}, days: string[], busy: Busy[], rates: Rate[], arrival: string, departure: string) {
  const nights = days.filter(d => d >= arrival && d < departure);
  const occupied = busy.find(e => e.property_id === property.id && e.start_date < departure && e.end_date > arrival);
  const status = occupied?.kind ?? (property.known && nights.length === (Date.parse(departure)-Date.parse(arrival))/86400000 ? "available" : "unknown");
  const nightly = nights.map(d => rates.filter(r => r.property_id === property.id && overlaps(r.start_date,r.end_date,d)));
  const currency = nightly[0]?.[0]?.currency ?? null;
  const complete = status === "available" && nightly.length > 0 && nightly.every(r => r.length === 1 && r[0].currency === currency && Number.isFinite(Number(r[0].amount)));
  return {status, currency, total: complete ? nightly.reduce((sum,r) => sum + Number(r[0].amount),0) : null};
}
