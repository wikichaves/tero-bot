import { requireRole } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

export default async function EnergyLayout({
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
