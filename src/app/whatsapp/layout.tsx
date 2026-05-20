import { requireRole } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

export default async function WhatsAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // WIK-107: sólo admin. /whatsapp expone toda la conversación con
  // huéspedes — gestor no necesita ese acceso.
  const profile = await requireRole(["admin"]);
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader profile={profile} />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
