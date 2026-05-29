import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import type { Profile, UserRole } from "@/lib/types";

export type TaskAssignee = {
  id: string;
  full_name: string | null;
  email: string;
  role: UserRole;
};

/**
 * WIK-250/251: a quién se le puede asignar una tarea (y por quién se puede
 * filtrar), según el rol del que mira.
 *
 *   - admin: todos los perfiles.
 *   - gestor (Manager): el Staff/Managers de SUS propiedades + uno mismo.
 *   - mantenimiento (Staff): solo uno mismo.
 *
 * Va por admin client porque `profiles_self_read` (RLS) solo deja a un
 * no-admin leer su propia fila — sin esto un Manager no podría ver ni
 * asignar a su Staff. El scope lo da el cruce con `profile_properties`.
 */
export async function getScopedAssignees(
  profile: Pick<Profile, "id" | "role" | "full_name" | "email">,
): Promise<TaskAssignee[]> {
  const adminDb = createAdminClient();

  if (profile.role === "admin") {
    const { data } = await adminDb
      .from("profiles")
      .select("id, full_name, email, role")
      .order("full_name", { ascending: true });
    return (data ?? []) as TaskAssignee[];
  }

  if (profile.role === "gestor") {
    const allowedIds = await getAllowedPropertyIds(profile);
    const ids = new Set<string>([profile.id]);
    if (allowedIds && allowedIds.length > 0) {
      const { data: links } = await adminDb
        .from("profile_properties")
        .select("profile_id")
        .in("property_id", allowedIds);
      for (const l of links ?? []) ids.add(l.profile_id as string);
    }
    const { data } = await adminDb
      .from("profiles")
      .select("id, full_name, email, role")
      .in("id", Array.from(ids))
      .order("full_name", { ascending: true });
    return (data ?? []) as TaskAssignee[];
  }

  // Staff: solo uno mismo.
  return [
    {
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      role: profile.role,
    },
  ];
}
