import { requireProfile } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

/**
 * WIK-119: /dashboard ahora accesible para los 3 roles.
 *
 *   - admin/gestor: reservas + alarmas + energía + mantenimiento
 *     (vista business-wide scopeada por property)
 *   - mantenimiento: solo sus tareas pendientes (el page condiciona
 *     el render según role)
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader profile={profile} />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
