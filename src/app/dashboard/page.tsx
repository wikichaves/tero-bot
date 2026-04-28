import { addDays, format, isSameDay, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import type { Reservation } from "@/lib/types";

const HORIZON_DAYS = 14;

export default async function DashboardPage() {
  const supabase = await createClient();
  const today = new Date();
  const horizon = addDays(today, HORIZON_DAYS);

  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .or(
      `and(check_in.gte.${today.toISOString().slice(0, 10)},check_in.lte.${horizon.toISOString().slice(0, 10)}),and(check_out.gte.${today.toISOString().slice(0, 10)},check_out.lte.${horizon.toISOString().slice(0, 10)})`,
    )
    .order("check_in", { ascending: true });

  const reservations = (data ?? []) as Reservation[];
  const checkIns = reservations.filter((r) =>
    isOnOrAfter(parseISO(r.check_in), today),
  );
  const checkOuts = reservations.filter((r) =>
    isOnOrAfter(parseISO(r.check_out), today),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Próximos {HORIZON_DAYS} días</h1>
        <p className="text-sm text-muted-foreground">
          {format(today, "EEEE d 'de' MMMM", { locale: es })}
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            No se pudo cargar reservas: {error.message}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <ReservationsCard
          title="Check-ins"
          description="Llegadas próximas"
          rows={checkIns}
          dateField="check_in"
        />
        <ReservationsCard
          title="Check-outs"
          description="Salidas próximas"
          rows={checkOuts}
          dateField="check_out"
        />
      </div>
    </div>
  );
}

function ReservationsCard({
  title,
  description,
  rows,
  dateField,
}: {
  title: string;
  description: string;
  rows: Reservation[];
  dateField: "check_in" | "check_out";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin reservas.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Huésped</TableHead>
                <TableHead>Origen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {format(parseISO(r[dateField]), "EEE d MMM", { locale: es })}
                  </TableCell>
                  <TableCell>{r.guest_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.source}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function isOnOrAfter(date: Date, ref: Date) {
  return date >= ref || isSameDay(date, ref);
}
