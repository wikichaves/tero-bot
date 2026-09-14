import type { Property, UtilityBill } from "@/lib/types";

export type BillingProperty = Pick<Property, "id" | "name" | "currency" | "padron">;
export type BillingGroup = { key: string; label: string; properties: BillingProperty[]; allocationCount: number };
const SHARED_INTERNET_PADRONES = new Set(["852", "853", "854"]);

export function getBillingGroup(property: BillingProperty | null, allProperties: BillingProperty[], utilityType: UtilityBill["utility_type"]): BillingGroup {
  if (!property) return { key: "orphan", label: "Sin propiedad", properties: [], allocationCount: 1 };
  if (utilityType === "internet" && property.padron && SHARED_INTERNET_PADRONES.has(property.padron)) {
    const members = allProperties.filter((p) => p.padron && SHARED_INTERNET_PADRONES.has(p.padron));
    return { key: "internet-shared-852-854", label: "Internet · conexión compartida", properties: members, allocationCount: members.length || 1 };
  }
  if ((utilityType === "luz" || utilityType === "agua") && property.padron) {
    const members = allProperties.filter((p) => p.padron === property.padron);
    return { key: `padron:${property.padron}`, label: `Padrón ${property.padron}`, properties: members, allocationCount: members.length || 1 };
  }
  return { key: `property:${property.id}`, label: property.name, properties: [property], allocationCount: 1 };
}

export function billDeduplicationKey(bill: UtilityBill): string {
  return [bill.provider, bill.account_number, bill.invoice_number, bill.period_from, bill.period_to, bill.amount, bill.currency].map((part) => part ?? "").join("|");
}
