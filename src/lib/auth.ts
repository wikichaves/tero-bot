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
  // Cualquier user que falla el role check va a /dashboard. El page condiciona
  // el render: admin/gestor ven vista business-wide; mantenimiento ve solo sus
  // tareas (WIK-119). Antes había un helper `homeForRole(role)` por si los
  // roles divergían — historia preservada en git, ahora todos van al mismo
  // path.
  if (!roles.includes(profile.role)) redirect("/dashboard");
  return profile;
}
