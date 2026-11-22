import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { NewPropertyDialog } from "./property-form-dialog";
import { PropertiesTable } from "./properties-table";
import type { Property } from "@/lib/types";

export default async function PropertiesPage() {
  await requireRole(["admin"]);
  const t = await getTranslations("adminPropertiesPage");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const properties = (data ?? []) as Property[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-4xl">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("countInSystem", { count: properties.length })}
          </p>
        </div>
        <NewPropertyDialog />
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            {error.message}
          </CardContent>
        </Card>
      )}

      <PropertiesTable properties={properties} />
    </div>
  );
}
