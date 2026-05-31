import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewUserDialog } from "./new-user-dialog";
import { UserActions } from "./user-actions";
import type { Profile, Property } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/roles";

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

  return (
    <div className="flex flex-col gap-6">
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

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.email")}</TableHead>
                <TableHead>{t("table.name")}</TableHead>
                <TableHead>{t("table.role")}</TableHead>
                <TableHead>{t("table.properties")}</TableHead>
                <TableHead>{t("table.whatsapp")}</TableHead>
                <TableHead>{t("table.created")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-muted-foreground"
                  >
                    {t("empty")}
                  </TableCell>
                </TableRow>
              ) : (
                profiles.map((p) => {
                  const scopedIds = scopedByProfile.get(p.id) ?? [];
                  const scopedNames = allProperties
                    .filter((prop) => scopedIds.includes(prop.id))
                    .map((prop) => prop.name);
                  return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.email}</TableCell>
                    <TableCell>{p.full_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ROLE_LABEL[p.role]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.role === "admin" ? (
                        <span className="text-muted-foreground italic">
                          {t("scope.all")}
                        </span>
                      ) : scopedNames.length === 0 ? (
                        <span className="text-amber-700 dark:text-amber-300">
                          {t("scope.unassigned")}
                        </span>
                      ) : (
                        scopedNames.join(", ")
                      )}
                    </TableCell>
                    <TableCell>{p.whatsapp ?? "—"}</TableCell>
                    <TableCell>
                      {format(parseISO(p.created_at), "d MMM yyyy", {
                        locale: es,
                      })}
                    </TableCell>
                    <TableCell>
                      <UserActions
                        profile={p}
                        isSelf={p.id === me.id}
                        allProperties={allProperties}
                        scopedPropertyIds={scopedIds}
                        botWhatsappNumber={botWhatsappNumber}
                      />
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
