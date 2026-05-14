import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
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
          <h1 className="text-2xl font-semibold">Propiedades</h1>
          <p className="text-sm text-muted-foreground">
            {properties.length} propiedad
            {properties.length === 1 ? "" : "es"} en el sistema.
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

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Orden</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Airbnb iCal</TableHead>
                <TableHead>Creada</TableHead>
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
                    Sin propiedades. Creá la primera con el botón{" "}
                    <em>Nueva propiedad</em>.
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
                    <TableCell>
                      {p.airbnb_ical_url ? (
                        <Badge variant="default">configurada</Badge>
                      ) : (
                        <Badge variant="secondary">—</Badge>
                      )}
                    </TableCell>
                    <TableCell>
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
