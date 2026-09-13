import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});

export const manualReservationSchema = z.object({
  property_id: z.string().uuid(),
  guest_name: z.string().trim().min(1).max(200),
  guest_phone: z.string().trim().max(40),
  check_in: date,
  check_out: date,
  guest_count: z.union([z.literal(""), z.coerce.number().int().min(1).max(100)]),
  payout_amount: z.union([z.literal(""), z.coerce.number().finite().min(0).max(10000000).multipleOf(0.01)]),
  payout_currency: z.enum(["USD", "UYU", "ARS"]),
  notes: z.string().trim().max(2000),
}).refine((value) => value.check_out > value.check_in, { path: ["check_out"] });

export function reservationPeriod(checkIn: string, checkOut: string, today: string) {
  if (checkOut <= today) return "past";
  if (checkIn > today) return "future";
  return "current";
}

export function manualIdentity(value: { property_id: string; guest_name: string; check_in: string; check_out: string }) {
  return JSON.stringify([value.property_id, value.guest_name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim(), value.check_in, value.check_out]);
}
