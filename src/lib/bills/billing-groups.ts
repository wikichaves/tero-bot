import type { Property, UtilityBill } from "@/lib/types";

export type BillingProperty = Pick<Property, "id" | "name" | "currency"> & {
  provider_accounts: Record<string, string> | null;
};

export type BillingGroup = {
  key: string;
  properties: BillingProperty[];
  allocationCount: number;
};

type GroupableBill = Pick<UtilityBill, "property_id" | "provider" | "account_number">;

/**
 * Agrupa una factura con las propiedades que comparten la misma cuenta del
 * proveedor, para que un único comprobante no se repita ni sugiera que cada
 * casa debe el total.
 *
 * La agrupación sale de `provider_accounts`, no del padrón. En los datos reales
 * el padrón no coincide con la titularidad de las cuentas: hay casas que
 * comparten padrón con cuentas de agua separadas, y casas de padrones distintos
 * que comparten una misma cuenta de luz. Agrupar por padrón fusionaba las
 * primeras y separaba las segundas.
 */
export function getBillingGroup(
  bill: GroupableBill,
  allProperties: BillingProperty[],
): BillingGroup {
  if (bill.account_number) {
    const members = allProperties.filter(
      (property) => property.provider_accounts?.[bill.provider] === bill.account_number,
    );
    if (members.length > 0) {
      return {
        key: `account:${bill.provider}:${bill.account_number}`,
        properties: members,
        allocationCount: members.length,
      };
    }
  }
  const owner = allProperties.find((property) => property.id === bill.property_id);
  if (!owner) return { key: "orphan", properties: [], allocationCount: 1 };
  return { key: `property:${owner.id}`, properties: [owner], allocationCount: 1 };
}

/**
 * Identidad de una factura para deduplicar: el mismo comprobante puede llegar
 * más de una vez desde distintos mails.
 */
export function billDeduplicationKey(bill: UtilityBill): string {
  return [
    bill.provider,
    bill.account_number,
    bill.invoice_number,
    bill.period_from,
    bill.period_to,
    bill.amount,
    bill.currency,
  ]
    .map((part) => part ?? "")
    .join("|");
}
