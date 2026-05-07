import Link from "next/link";
import { notFound } from "next/navigation";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  Property,
  Reservation,
  WhatsAppConversation,
  WhatsAppMessage,
} from "@/lib/types";
import { ReservationDetailActions } from "./detail-actions";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<Reservation["source"], string> = {
  airbnb: "Airbnb",
  booking: "Booking",
  manual: "Manual",
};

type ReservationWithProperty = Reservation & {
  property: Pick<Property, "id" | "name"> | null;
};

function normalizePhone(p: string | null): string | null {
  if (!p) return null;
  const trimmed = p.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/\D/g, "")}`;
}

export default async function ReservationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin", "gestor"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: reservationData } = await supabase
    .from("reservations")
    .select("*, property:properties(id, name)")
    .eq("id", id)
    .maybeSingle();

  if (!reservationData) notFound();
  const reservation = reservationData as ReservationWithProperty;

  // Try to find a WhatsApp conversation matching the guest's phone, and pull
  // its messages. Best-effort: only matches if guest_phone normalizes to
  // exactly the conversation's phone_number.
  const phone = normalizePhone(reservation.guest_phone);
  let conversation: WhatsAppConversation | null = null;
  let messages: WhatsAppMessage[] = [];
  if (phone) {
    const { data: convoData } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .eq("phone_number", phone)
      .maybeSingle();
    if (convoData) {
      conversation = convoData as WhatsAppConversation;
      const { data: msgs } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .eq("conversation_id", conversation.id)
        .order("sent_at", { ascending: true })
        .limit(100);
      messages = (msgs ?? []) as WhatsAppMessage[];
    }
  }

  const checkIn = parseISO(reservation.check_in);
  const checkOut = parseISO(reservation.check_out);
  const nights = Math.max(0, differenceInCalendarDays(checkOut, checkIn));

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">
          {reservation.guest_name ?? "Reserva sin nombre"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {reservation.property?.name ?? "Propiedad desconocida"} ·{" "}
          {format(checkIn, "EEE d MMM", { locale: es })} →{" "}
          {format(checkOut, "EEE d MMM yyyy", { locale: es })} · {nights} noche
          {nights === 1 ? "" : "s"}
        </p>
      </div>

      <ReservationDetailActions reservation={reservation} />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Datos de la reserva</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Origen</dt>
              <dd>
                <Badge variant="secondary">
                  {SOURCE_LABEL[reservation.source]}
                </Badge>
              </dd>
              <dt className="text-muted-foreground">Propiedad</dt>
              <dd>{reservation.property?.name ?? "—"}</dd>
              <dt className="text-muted-foreground">Check-in</dt>
              <dd>
                {format(checkIn, "EEEE d 'de' MMMM yyyy", { locale: es })}
              </dd>
              <dt className="text-muted-foreground">Check-out</dt>
              <dd>
                {format(checkOut, "EEEE d 'de' MMMM yyyy", { locale: es })}
              </dd>
              {reservation.external_id && (
                <>
                  <dt className="text-muted-foreground">Código externo</dt>
                  <dd className="font-mono text-xs break-all">
                    {reservation.external_id}
                  </dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Huésped</CardTitle>
            <CardDescription>
              {reservation.guest_phone
                ? "Datos cargados manualmente."
                : "Sin datos. Editá la reserva para agregar nombre y WhatsApp."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Nombre</dt>
              <dd>{reservation.guest_name ?? "—"}</dd>
              <dt className="text-muted-foreground">WhatsApp</dt>
              <dd>
                {reservation.guest_phone ? (
                  <span className="font-mono">{reservation.guest_phone}</span>
                ) : (
                  "—"
                )}
              </dd>
              {reservation.notes && (
                <>
                  <dt className="text-muted-foreground">Notas</dt>
                  <dd className="whitespace-pre-wrap">{reservation.notes}</dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conversación WhatsApp</CardTitle>
          <CardDescription>
            {!phone
              ? "Cargá el WhatsApp del huésped para ver mensajes asociados."
              : !conversation
                ? "Sin mensajes con este número todavía."
                : `${messages.length} mensaje${messages.length === 1 ? "" : "s"} con ${conversation.display_name ?? conversation.phone_number}.`}
          </CardDescription>
        </CardHeader>
        {conversation && messages.length > 0 && (
          <CardContent>
            <ul className="flex flex-col gap-2">
              {messages.slice(-20).map((m) => (
                <li
                  key={m.id}
                  className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                      m.direction === "outbound"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted border rounded-bl-sm"
                    }`}
                  >
                    {m.body && (
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    )}
                    <p
                      className={`text-[10px] mt-1 ${m.direction === "outbound" ? "opacity-70" : "text-muted-foreground"}`}
                    >
                      {format(parseISO(m.sent_at), "d MMM HH:mm", {
                        locale: es,
                      })}
                      {m.status && ` · ${m.status}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {messages.length > 20 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Mostrando últimos 20 de {messages.length}.{" "}
                <Link
                  href={`/whatsapp/${conversation.id}`}
                  className="underline hover:text-foreground"
                >
                  Ver conversación completa
                </Link>
              </p>
            )}
            {messages.length <= 20 && (
              <p className="mt-3 text-xs">
                <Link
                  href={`/whatsapp/${conversation.id}`}
                  className="text-muted-foreground underline hover:text-foreground"
                >
                  Ver en inbox
                </Link>
              </p>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
