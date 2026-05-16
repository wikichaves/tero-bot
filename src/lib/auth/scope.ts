import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

/**
 * Scope por property (WIK-94). Permite que gestor/mantenimiento solo
 * vean/manejen las propiedades que un admin les asigna.
 *
 * Reglas:
 *   - admin: acceso a TODAS las properties (no se consulta DB → null).
 *   - gestor / mantenimiento: la tabla `profile_properties` define
 *     qué properties ven. Si la tabla está vacía para ese profile,
 *     no ve ninguna (array vacío).
 *
 * Helper devuelve `null` cuando hay acceso total ("sin filtro"), o un
 * array de UUIDs (puede ser vacío) cuando hay scope.
 *
 * Uso típico en queries:
 *
 *   const allowed = await getAllowedPropertyIds(profile);
 *   const q = supabase.from("reservations").select(...);
 *   if (allowed !== null) q = q.in("property_id", allowed);
 *
 * Si `allowed` es array vacío, el `.in("property_id", [])` filtra
 * todas las rows (cero matches). Eso es lo correcto — un gestor sin
 * properties asignadas no ve nada.
 */
export async function getAllowedPropertyIds(
  profile: Pick<Profile, "id" | "role">,
): Promise<string[] | null> {
  if (profile.role === "admin") return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profile_properties")
    .select("property_id")
    .eq("profile_id", profile.id);
  if (error) {
    console.warn(
      `[getAllowedPropertyIds] failed for profile=${profile.id}: ${error.message}`,
    );
    // En error, devolver [] para fail-safe (no exponer data sin scope).
    return [];
  }
  return (data ?? []).map((r) => r.property_id);
}

/**
 * Sugar para chequear si un profile tiene acceso a una property
 * específica. Devuelve true para admin siempre.
 */
export async function profileCanAccessProperty(
  profile: Pick<Profile, "id" | "role">,
  propertyId: string,
): Promise<boolean> {
  if (profile.role === "admin") return true;
  const allowed = await getAllowedPropertyIds(profile);
  return allowed === null || allowed.includes(propertyId);
}
