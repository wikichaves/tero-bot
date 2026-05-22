"use client";

import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { LockPassword, Reservation } from "@/lib/types";
import { EditReservationDialog } from "@/app/dashboard/edit-reservation-dialog";
import { generateAccessCode } from "./actions";
import { PreCheckinTriggerButton } from "./pre-checkin-button";

export function ReservationDetailActions({
  reservation,
  initialAccessCode,
  hasPrimaryLock,
}: {
  reservation: Reservation;
  initialAccessCode: LockPassword | null;
  hasPrimaryLock: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [accessCode, setAccessCode] = useState<LockPassword | null>(
    initialAccessCode,
  );
  const [pending, startTransition] = useTransition();

  function onGenerateCode() {
    startTransition(async () => {
      const result = await generateAccessCode(reservation.id);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if ("ok" in result && result.ok) {
        toast.success(
          result.already_existed
            ? `Código existente: ${result.code}`
            : `Código generado: ${result.code}`,
        );
        // Optimistic local update so the user sees the code immediately;
        // revalidatePath will refresh on next render with the canonical row.
        setAccessCode({
          id: "pending",
          property_device_id: "",
          reservation_id: reservation.id,
          name: "",
          password: result.code,
          tuya_password_id: "",
          effective_time: result.effective_at,
          invalid_time: result.invalid_at,
          status: "active",
          created_by: null,
          created_at: new Date().toISOString(),
        });
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setEditOpen(true)}>Editar</Button>
        <Button
          variant="outline"
          onClick={onGenerateCode}
          disabled={pending || !hasPrimaryLock}
          title={
            !hasPrimaryLock
              ? "La propiedad no tiene cerradura primaria asignada (admin/tuya)"
              : undefined
          }
        >
          {pending
            ? "Generando…"
            : accessCode
              ? "Ver / regenerar código"
              : "Generar código de acceso"}
        </Button>
        <Button
          variant="outline"
          disabled
          title="Disponible cuando los templates de Meta estén aprobados (WIK-28)"
        >
          Enviar WhatsApp
        </Button>
        {/* WIK-125: override del cron de pre-checkin conditioning. */}
        <PreCheckinTriggerButton reservationId={reservation.id} />
      </div>

      {accessCode && (
        <div className="rounded-lg border bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">
            Código de acceso a la cerradura
          </p>
          <p className="mt-1 font-mono text-3xl tracking-widest">
            {accessCode.password}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Válido desde{" "}
            {format(parseISO(accessCode.effective_time), "EEE d MMM HH:mm", {
              locale: es,
            })}{" "}
            hasta{" "}
            {format(parseISO(accessCode.invalid_time), "EEE d MMM HH:mm", {
              locale: es,
            })}
            . Tuya genera el código solo una vez — copialo si lo necesitás
            para mandar fuera del panel.
          </p>
        </div>
      )}

      <EditReservationDialog
        reservation={reservation}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
