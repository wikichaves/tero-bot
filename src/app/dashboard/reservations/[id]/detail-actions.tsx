"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Reservation } from "@/lib/types";
import { EditReservationDialog } from "@/app/dashboard/edit-reservation-dialog";

export function ReservationDetailActions({
  reservation,
}: {
  reservation: Reservation;
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setEditOpen(true)}>Editar</Button>
        <Button
          variant="outline"
          disabled
          title="Disponible cuando esté la integración con cerradura (WIK-32)"
        >
          Generar código de acceso
        </Button>
        <Button
          variant="outline"
          disabled
          title="Disponible cuando los templates de Meta estén aprobados (WIK-28)"
        >
          Enviar WhatsApp
        </Button>
      </div>
      <EditReservationDialog
        reservation={reservation}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
