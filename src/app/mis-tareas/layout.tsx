import { requireProfile } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

export default async function MisTareasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Open to any authenticated profile — each user sees only their own
  // assigned tasks (enforced both in the query and via RLS).
  const profile = await requireProfile();
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader profile={profile} />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
