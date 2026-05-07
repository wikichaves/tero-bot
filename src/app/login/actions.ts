"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeForRole } from "@/lib/auth";
import type { UserRole } from "@/lib/types";

export async function signIn(input: { email: string; password: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(input);
  if (error) return { error: error.message };

  // Look up role to send each user to their natural landing page. Falling
  // back to /dashboard is safe — requireRole will redirect them onward if
  // they shouldn't be there.
  let role: UserRole | null = null;
  if (data?.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();
    role = (profile?.role as UserRole | undefined) ?? null;
  }
  redirect(role ? homeForRole(role) : "/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
