import { requireRole } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Staff (limpieza/mantenimiento) get redirected to /mis-tareas by
  // requireRole → homeForRole. The dashboard surfaces business-wide data
  // (reservations, team-wide tasks, property names) that they shouldn't
  // see anyway.
  const profile = await requireRole(["admin", "gestor"]);
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader profile={profile} />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
