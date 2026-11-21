import { z } from "zod";
import ICAL from "ical.js";

export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
});
export const rangeSchema = z.object({ property_id: z.string().uuid(), start_date: daySchema, end_date: daySchema }).refine(v => v.start_date < v.end_date);
export const rateSchema = rangeSchema.safeExtend({ amount: z.coerce.number().positive().max(10000000), currency: z.enum(["USD", "UYU", "ARS"]) });
export type Busy = { id: string; property_id: string; start_date: string; end_date: string; kind: "reservation" | "block" };
export function overlaps(start: string, end: string, day: string) { return start <= day && day < end; }
export function monthDays(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 2000 || Number(month.slice(0, 4)) > 2200) throw new Error("Invalid month");
  const date = new Date(`${month}-01T00:00:00Z`);
  const days: string[] = [];
  while (date.toISOString().startsWith(month)) { days.push(date.toISOString().slice(0, 10)); date.setUTCDate(date.getUTCDate() + 1); }
  return days;
}
export function parseAvailability(ics: string) {
  const component = new ICAL.Component(ICAL.parse(ics));
  if (component.name !== "vcalendar") throw new Error("Invalid calendar");
  return component.getAllSubcomponents("vevent").flatMap(c => {
    const e = new ICAL.Event(c);
    if (e.uid?.startsWith("tero-local-") || c.getFirstPropertyValue("status") === "CANCELLED") return [];
    if (!e.uid || e.isRecurring() || !e.startDate?.isDate || !e.endDate?.isDate) throw new Error("Unsupported calendar event");
    const start_date = daySchema.parse(e.startDate.toString());
    const end_date = daySchema.parse(e.endDate.toString());
    if (start_date >= end_date) throw new Error("Invalid calendar interval");
    return [{ uid: e.uid, start_date, end_date, kind: /not\s*available|block/i.test(e.summary ?? "") ? "block" : "reservation" }];
  });
}
export function exportCalendar(events: Pick<Busy, "id" | "start_date" | "end_date">[], stamp = new Date()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//tero.bot//Availability//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    if (!/^[a-zA-Z0-9-]+$/.test(e.id)) throw new Error("Invalid event ID");
    daySchema.parse(e.start_date); daySchema.parse(e.end_date);
    lines.push("BEGIN:VEVENT", `UID:tero-local-${e.id}@tero.bot`, `DTSTAMP:${stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`, `DTSTART;VALUE=DATE:${e.start_date.replaceAll("-", "")}`, `DTEND;VALUE=DATE:${e.end_date.replaceAll("-", "")}`, "SUMMARY:Unavailable", "TRANSP:OPAQUE", "END:VEVENT");
  }
  return [...lines, "END:VCALENDAR", ""].join("\r\n");
}
