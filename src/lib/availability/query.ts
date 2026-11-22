import { daySchema } from "./core";

export function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
export function isAvailabilityQuery(text: string) {
  return /^\/?(disponibilidad|availability)(?:@\S+)?\b/i.test(text.trim()) || /\b(busco|busca|buscamos|necesito|necesita|quiero|hay|tenes|tienen)\b.*\b(casas?|personas?|huespedes|disponib)/.test(normalize(text));
}
export type AvailabilityQuery = { guests: number | null; start: string | null; end: string | null; filter: string; error: boolean };
export function parseAvailabilityQuery(text: string): AvailabilityQuery {
  let rest = normalize(text).replace(/^\/?(disponibilidad|availability)(?:@\S+)?\s*/, "");
  const people = rest.match(/\b(\d+)\s*(?:personas?|huespedes|pax|guests?|people)\b/);
  const guests = people ? Number(people[1]) : null;
  if (people) rest = rest.replace(people[0], "");
  const dates: string[] = [];
  rest = rest.replace(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/g, raw => {
    const parts = raw.split("/");
    dates.push(parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}` : raw);
    return " ";
  });
  const error = (guests !== null && (guests < 1 || guests > 100)) || (dates.length !== 0 && dates.length !== 2) || dates.some(d => !daySchema.safeParse(d).success) || (dates.length === 2 && (dates[0] >= dates[1] || (Date.parse(dates[1])-Date.parse(dates[0]))/86400000 > 366));
  // Remove conversational glue, never an arbitrary property identifier.
  const filter = rest.replace(/\b(busco|busca|buscamos|necesito|necesita|quiero|hay|tenes|tienen|una|un|para|del|desde|hasta|al|a|el|la|las|en|por|disponibles?|disponibilidad|todas|todas las casas)\b/g," ").replace(/[?,.!]/g," ").replace(/\s+/g," ").trim();
  return { guests, start: dates[0] ?? null, end: dates[1] ?? null, filter: /^(casas?|all|todas las casas)?$/.test(filter) ? "" : filter, error: error || /\d{1,2}\/\d{1,2}|\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|manana|hoy|semana)\b/.test(filter.replace(/14 de julio/g, "")) };
}

export function freeRanges(days: string[], occupied: Set<string>) {
  const ranges: {start: string; end: string}[] = [];
  for (const day of days) {
    if (occupied.has(day)) continue;
    const next = new Date(`${day}T00:00:00Z`); next.setUTCDate(next.getUTCDate()+1);
    const end = next.toISOString().slice(0,10);
    const last = ranges.at(-1);
    if (last?.end === day) last.end = end;
    else ranges.push({start:day,end});
  }
  return ranges;
}
