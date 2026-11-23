import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { NewUserDialog } from "./new-user-dialog";
import { RolePermissions } from "./role-permissions";
import { UsersTable } from "./users-table";
import type { Profile, Property } from "@/lib/types";

export default async function UsersPage() {
  const me = await requireRole(["admin"]);
  const t = await getTranslations("usersPage");
  // WIK-278: número del bot para construir el link click-to-chat de activación.
  const botWhatsappNumber = process.env.WHATSAPP_DISPLAY_NUMBER ?? null;
  const supabase = await createClient();
  const [profilesRes, propsRes, scopesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("properties").select("id, name").order("sort_order"),
    supabase.from("profile_properties").select("profile_id, property_id"),
  ]);
  const { data, error } = profilesRes;
  const profiles = (data ?? []) as Profile[];
  const allProperties = (propsRes.data ?? []) as Pick<Property, "id" | "name">[];
  // Build a map: profile_id → property_ids[].
  const scopedByProfile = new Map<string, string[]>();
  for (const row of (scopesRes.data ?? []) as Array<{
    profile_id: string;
    property_id: string;
  }>) {
    const list = scopedByProfile.get(row.profile_id) ?? [];
    list.push(row.property_id);
    scopedByProfile.set(row.profile_id, list);
  }

  // Agency scope has its own authoritative grants, not legacy staff assignments.
  const agencyScopes = await createAdminClient().from("agency_properties").select("profile_id,property_id");
  if (agencyScopes.error) throw new Error("Unable to load agency access");
  for (const profile of profiles.filter(p=>p.role==="agency")) scopedByProfile.set(profile.id,[]);
  for (const row of agencyScopes.data ?? []) {
    const profile=profiles.find(p=>p.id===row.profile_id);
    if (profile?.role==="agency") scopedByProfile.get(row.profile_id)!.push(row.property_id);
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-4xl">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle", { n: profiles.length })}
          </p>
        </div>
        <NewUserDialog allProperties={allProperties} />
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            {error.message}
          </CardContent>
        </Card>
      )}

      <UsersTable profiles={profiles} allProperties={allProperties} scopedByProfile={Object.fromEntries(scopedByProfile)} selfId={me.id} botWhatsappNumber={botWhatsappNumber} />
      <RolePermissions />
    </div>
  );
}
