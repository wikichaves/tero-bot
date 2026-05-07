import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireProfile(): Promise<Profile> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error || !data) {
    // Profile missing — auth row exists but profile wasn't created. Force re-login.
    await supabase.auth.signOut();
    redirect("/login");
  }
  return data as Profile;
}

export async function requireRole(roles: UserRole[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect(homeForRole(profile.role));
  return profile;
}

/**
 * The default landing page for a given role. Admin/gestor see the
 * reservation dashboard; staff (limpieza/mantenimiento) only see their
 * own task list.
 */
export function homeForRole(role: UserRole): string {
  if (role === "limpieza" || role === "mantenimiento") return "/mis-tareas";
  return "/dashboard";
}
