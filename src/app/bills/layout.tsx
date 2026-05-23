import { requireRole } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

export default async function FacturasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["admin", "gestor"]);
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader profile={profile} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
