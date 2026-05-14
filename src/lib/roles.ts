import type { UserRole } from "@/lib/types";

/**
 * Labels capitalizados de los roles para mostrar en UI. Los valores en
 * DB siguen siendo lowercase (enum de Postgres); este map convierte
 * `"admin"` → `"Admin"`, etc. Centralizado acá para que dropdowns,
 * tablas y selects no se desincronicen.
 */
export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  gestor: "Gestor",
  mantenimiento: "Mantenimiento",
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
