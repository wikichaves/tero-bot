import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/types";

export function SiteHeader({ profile }: { profile: Profile }) {
  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="font-semibold">
          Acme Rentals
        </Link>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Link href="/dashboard" className="hover:text-foreground">
            Dashboard
          </Link>
          {profile.role === "admin" && (
            <Link href="/admin/users" className="hover:text-foreground">
              Usuarios
            </Link>
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
