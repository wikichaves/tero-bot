import { redirect } from "next/navigation";
import { homeForRole, requireProfile } from "@/lib/auth";

export default async function Home() {
  // Send each role to its natural landing page (admin/gestor → /dashboard,
  // staff → /mis-tareas). requireProfile redirects to /login if anonymous.
  const profile = await requireProfile();
  redirect(homeForRole(profile.role));
}
