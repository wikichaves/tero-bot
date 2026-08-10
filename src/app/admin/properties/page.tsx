import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PropertyThumb } from "@/components/property-thumb";
import { NewPropertyDialog } from "./property-form-dialog";
import { PropertyActions } from "./property-actions";
import { PropertySortControls } from "./property-sort-controls";
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

      {/* Mobile: cards apiladas (sin scroll horizontal). Desktop: tabla. */}
      <div className="flex flex-col gap-2 md:hidden">
        {properties.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              {t.rich("emptyState", { em: (chunks) => <em>{chunks}</em> })}
            </CardContent>
          </Card>
        ) : (
          properties.map((p, idx) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <PropertyThumb
                    propertyId={p.id}
                    cacheBuster={p.created_at}
                    size="sm"
                    alt={p.name}
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">{p.name}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.airbnb_ical_url ? (
                        <Badge variant="default">{t("badge.configured")}</Badge>
                      ) : (
                        <Badge variant="secondary">—</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <PropertySortControls
                    propertyId={p.id}
                    isFirst={idx === 0}
                    isLast={idx === properties.length - 1}
                  />
                  <PropertyActions property={p} />
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card className="hidden md:block">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">{t("table.order")}</TableHead>
                <TableHead>{t("table.name")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("table.airbnbIcal")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("table.created")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    {t.rich("emptyState", {
                      em: (chunks) => <em>{chunks}</em>,
                    })}
                  </TableCell>
                </TableRow>
              ) : (
                properties.map((p, idx) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <PropertySortControls
                        propertyId={p.id}
                        isFirst={idx === 0}
                        isLast={idx === properties.length - 1}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <PropertyThumb
                          propertyId={p.id}
                          cacheBuster={p.created_at}
                          size="sm"
                          alt={p.name}
                        />
                        <span>{p.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {p.airbnb_ical_url ? (
                        <Badge variant="default">{t("badge.configured")}</Badge>
                      ) : (
                        <Badge variant="secondary">—</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {format(parseISO(p.created_at), "d MMM yyyy", {
                        locale: es,
                      })}
                    </TableCell>
                    <TableCell>
                      <PropertyActions property={p} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
