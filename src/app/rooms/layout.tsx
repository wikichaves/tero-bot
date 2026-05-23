import { requireRole } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

/**
 * Layout para /rooms (WIK-82). Mismo patrón que /energy: chequea
 * que el usuario sea admin/gestor (los staff no ven este módulo),
 * renderea el SiteHeader y deja main como contenedor del page.
 */
export default async function AmbientesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["admin", "gestor"]);
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader profile={profile} />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
