import type { UserRole } from "@/lib/types";

/**
 * Labels capitalizados de los roles para mostrar en UI. Los valores en
 * DB siguen siendo lowercase (enum de Postgres); este map convierte
 * `"admin"` → `"Admin"`, etc. Centralizado acá para que dropdowns,
 * tablas y selects no se desincronicen.
 *
 * WIK-241: el rol `mantenimiento` se MUESTRA como "Staff". El valor
 * interno del enum (`mantenimiento`) queda igual — renombrar el enum de
 * Postgres tocaría RLS policies + 70+ usos + filas existentes (migración
 * riesgosa, cero beneficio user-facing más allá del label). Solo cambia
 * lo que ve el operador.
 */
export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  gestor: "Gestor",
  mantenimiento: "Staff",
};

/** Orden canónico de roles en dropdowns y validators. */
export const ALL_ROLES: readonly UserRole[] = [
  "admin",
  "gestor",
  "mantenimiento",
] as const;

/** Helper para casos donde sólo tenemos el string y queremos el label. */
export function formatRoleLabel(role: UserRole): string {
  return ROLE_LABEL[role] ?? role;
}
