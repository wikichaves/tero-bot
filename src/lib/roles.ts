import type { UserRole } from "@/lib/types";

/**
 * Labels capitalizados de los roles para mostrar en UI. Los valores en
 * DB siguen siendo lowercase (enum de Postgres); este map convierte
 * `"admin"` → `"Admin"`, etc. Centralizado acá para que dropdowns,
 * tablas y selects no se desincronicen.
 *
 * WIK-241: el rol `mantenimiento` se MUESTRA como "Staff". WIK-245: el
 * rol `gestor` se MUESTRA como "Manager". En ambos casos el valor interno
 * del enum (`mantenimiento` / `gestor`) queda igual — renombrar el enum de
 * Postgres tocaría RLS policies + 70+ usos + filas existentes (migración
 * riesgosa, cero beneficio user-facing más allá del label). Solo cambia
 * lo que ve el operador. Jerarquía: Admin > Manager > Staff > Guest.
 *
 * WIK-310: el rol `guest` se MUESTRA como "Guest". Es un usuario sin acceso
 * al dashboard (sin password usable) que sólo habla con el bot de WhatsApp
 * (comandos `ambientes` y `ayuda`).
 */
export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  gestor: "Manager",
  mantenimiento: "Staff",
  guest: "Guest",
};

/** Orden canónico de roles en dropdowns y validators. */
export const ALL_ROLES: readonly UserRole[] = [
  "admin",
  "gestor",
  "mantenimiento",
  "guest",
] as const;

/** Helper para casos donde sólo tenemos el string y queremos el label. */
export function formatRoleLabel(role: UserRole): string {
  return ROLE_LABEL[role] ?? role;
}
