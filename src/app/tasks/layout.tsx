import { requireProfile } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

/**
 * WIK-109: /tasks ahora es la única vista de tareas — accesible para
 * los 3 roles. El filtro de qué tareas se muestran depende del role
 * (ver page.tsx).
 */
export default async function TasksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
