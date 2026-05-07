import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/types";

export function SiteHeader({ profile }: { profile: Profile }) {
  const isStaff =
    profile.role === "limpieza" || profile.role === "mantenimiento";
  const homeHref = isStaff ? "/mis-tareas" : "/dashboard";

  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <div className="flex items-center gap-6">
        <Link href={homeHref} className="font-semibold">
          Acme Rentals
        </Link>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          {/* Staff (limpieza/mantenimiento) only need their own task list. */}
          {isStaff && (
            <Link href="/mis-tareas" className="hover:text-foreground">
              Mis tareas
            </Link>
          )}
          {!isStaff && (
            <Link href="/dashboard" className="hover:text-foreground">
              Dashboard
            </Link>
          )}
          {(profile.role === "admin" || profile.role === "gestor") && (
            <>
              <Link href="/tasks" className="hover:text-foreground">
                Tareas
              </Link>
              <Link href="/mis-tareas" className="hover:text-foreground">
                Mis tareas
              </Link>
              <Link href="/whatsapp" className="hover:text-foreground">
                WhatsApp
              </Link>
              <Link href="/energy" className="hover:text-foreground">
                Energía
              </Link>
            </>
          )}
          {profile.role === "admin" && (
            <>
              <Link
                href="/admin/properties"
                className="hover:text-foreground"
              >
                Propiedades
              </Link>
              <Link href="/admin/users" className="hover:text-foreground">
                Usuarios
              </Link>
              <Link href="/admin/tuya" className="hover:text-foreground">
                Tuya
              </Link>
              <Link
                href="/admin/tuya/lock"
                className="hover:text-foreground"
              >
                Cerraduras
              </Link>
            </>
          )}
        </nav>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">{profile.email}</span>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm">
            Salir
          </Button>
        </form>
      </div>
    </header>
  );
}
