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
  LockPassword,
  Property,
  Reservation,
  Task,
  WhatsAppConversation,
  WhatsAppMessage,
} from "@/lib/types";
import { extractPhotos } from "@/lib/whatsapp/create-task";
import { ReservationDetailActions } from "./detail-actions";

const TASK_STATUS_LABEL: Record<Task["status"], string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Hecha",
};

const TASK_STATUS_BADGE: Record<
  Task["status"],
  "default" | "secondary" | "outline"
> = {
  pending: "secondary",
  in_progress: "default",
  done: "outline",
};

const TASK_KIND_LABEL: Record<Task["kind"], string> = {
  limpieza: "Limpieza",
  mantenimiento: "Mantenimiento",
  insumos: "Insumos",
  otro: "Otro",
};

type CleaningTask = Task & {
  assignee: { full_name: string | null; email: string } | null;
};

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

  // Existing access code for this reservation (if generated previously)
  // and whether the property has a primary lock to enable the button.
  const [accessCodeRes, primaryLockRes] = await Promise.all([
    supabase
      .from("lock_passwords")
      .select("*")
      .eq("reservation_id", reservation.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    reservation.property?.id
      ? supabase
          .from("property_devices")
          .select("id")
          .eq("property_id", reservation.property.id)
          .eq("device_kind", "lock")
          .eq("is_primary", true)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const accessCode = (accessCodeRes.data ?? null) as LockPassword | null;
  const hasPrimaryLock = !!primaryLockRes.data;

  // Cleaning task auto-created (or manually created) for this checkout date.
  // We dedup by (property_id, kind=limpieza, due_date=check_out) — the same
  // tuple the airbnb sync hook uses, so this surfaces the auto-task too.
  const cleaningTaskRes = reservation.property?.id
    ? await supabase
        .from("tasks")
        .select(
          "*, assignee:profiles!tasks_assigned_to_fkey(full_name, email)",
        )
        .eq("property_id", reservation.property.id)
        .eq("kind", "limpieza")
        .eq("due_date", reservation.check_out)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const cleaningTask = (cleaningTaskRes.data ?? null) as CleaningTask | null;

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

      {reservation.status === "cancelled" && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm">
            <Badge variant="destructive">Cancelada</Badge>{" "}
            <span className="ml-2 text-muted-foreground">
              Esta reserva fue cancelada vía email de Airbnb.
            </span>
          </CardContent>
        </Card>
      )}

      <ReservationDetailActions
        reservation={reservation}
        initialAccessCode={accessCode}
        hasPrimaryLock={hasPrimaryLock}
      />

      {(reservation.reservation_code ||
        reservation.guest_count != null ||
        reservation.payout_amount != null ||
        reservation.guest_message ||
        reservation.guest_photo_url) && (
        <Card>
          <CardHeader>
            <CardTitle>Detalles de Airbnb</CardTitle>
            <CardDescription>
              Datos extra extraídos del email de confirmación.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {/* En mobile la foto se stackea arriba para que la <dl> pueda
                usar el ancho completo del card. Si la foto va al costado,
                la columna de values queda demasiado angosta y el mensaje
                del huésped (que suele ser largo) se rompe vertical-mente
                con cada palabra cortada al borde. */}
            <div className="flex flex-col items-start gap-4 sm:flex-row">
              {reservation.guest_photo_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={reservation.guest_photo_url}
                  alt={
                    reservation.guest_name
                      ? `Foto de ${reservation.guest_name}`
                      : "Foto del huésped"
                  }
                  className="h-20 w-20 shrink-0 rounded-full border object-cover"
                  loading="lazy"
                />
              )}
              <dl className="grid w-full flex-1 grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
                {reservation.reservation_code && (
                  <>
                    <dt className="text-muted-foreground">Código</dt>
                    <dd className="font-mono">
                      {reservation.reservation_code}
                    </dd>
                  </>
                )}
                {reservation.guest_count != null && (
                  <>
                    <dt className="text-muted-foreground">Huéspedes</dt>
                    <dd>{reservation.guest_count}</dd>
                  </>
                )}
                {reservation.payout_amount != null && (
                  <>
                    <dt className="text-muted-foreground">Payout</dt>
                    <dd>
                      {reservation.payout_currency
                        ? `${reservation.payout_currency} `
                        : ""}
                      {reservation.payout_amount.toLocaleString("es-UY", {
                        maximumFractionDigits: 2,
                      })}
                    </dd>
                  </>
                )}
                {reservation.guest_message && (
                  <>
                    {/* Mensaje del huésped: label arriba + value
                        full-width abajo (col-span-full). Suele ser largo
                        y forzarlo a 2 columnas lo rompe. */}
                    <dt className="col-span-full text-muted-foreground">
                      Mensaje del huésped
                    </dt>
                    <dd className="col-span-full whitespace-pre-wrap break-words">
                      {reservation.guest_message}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          </CardContent>
        </Card>
      )}

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
          <CardTitle>Tarea de limpieza (post-checkout)</CardTitle>
          <CardDescription>
            {cleaningTask
              ? `Tarea para ${format(checkOut, "EEEE d 'de' MMMM", {
                  locale: es,
                })}`
              : "Aún no hay una tarea de limpieza para esta fecha."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {cleaningTask ? (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Título</dt>
              <dd className="font-medium">{cleaningTask.title}</dd>
              <dt className="text-muted-foreground">Tipo</dt>
              <dd>
                <Badge variant="outline">
                  {TASK_KIND_LABEL[cleaningTask.kind]}
                </Badge>
              </dd>
              <dt className="text-muted-foreground">Estado</dt>
              <dd>
                <Badge variant={TASK_STATUS_BADGE[cleaningTask.status]}>
                  {TASK_STATUS_LABEL[cleaningTask.status]}
                </Badge>
              </dd>
              <dt className="text-muted-foreground">Asignado</dt>
              <dd>
                {cleaningTask.assignee ? (
                  cleaningTask.assignee.full_name ??
                  cleaningTask.assignee.email
                ) : (
                  <span className="text-muted-foreground">Sin asignar</span>
                )}
              </dd>
              {(() => {
                const { urls, cleaned } = extractPhotos(
                  cleaningTask.description,
                );
                return (
                  <>
                    {cleaned && (
                      <>
                        <dt className="text-muted-foreground self-start">
                          Descripción
                        </dt>
                        <dd className="whitespace-pre-wrap">{cleaned}</dd>
                      </>
                    )}
                    {urls.length > 0 && (
                      <>
                        <dt className="text-muted-foreground">Fotos</dt>
                        <dd>
                          {urls.length} foto
                          {urls.length === 1 ? "" : "s"} —{" "}
                          <Link
                            href={`/tasks/${cleaningTask.id}`}
                            className="underline hover:text-foreground"
                          >
                            ver en la tarea
                          </Link>
                        </dd>
                      </>
                    )}
                  </>
                );
              })()}
            </dl>
          ) : (
            <p className="text-muted-foreground">
              Se crea automáticamente al sincronizar la reserva. También podés
              crear una manualmente desde{" "}
              <Link
                href={`/tasks?property=${reservation.property?.id ?? ""}`}
                className="underline hover:text-foreground"
              >
                Tareas
              </Link>
              .
            </p>
          )}
          <p className="mt-3 text-xs">
            <Link
              href="/tasks?status=pending"
              className="text-muted-foreground underline hover:text-foreground"
            >
              Ver todas las tareas →
            </Link>
          </p>
        </CardContent>
      </Card>

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
