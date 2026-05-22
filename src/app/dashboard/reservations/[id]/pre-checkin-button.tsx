"use client";

import { useTransition } from "react";
import { Thermometer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { triggerPreCheckinNow } from "./pre-checkin-actions";

/**
 * Override manual del flow de pre-checkin (WIK-125). Borra cualquier
 * tracking row existente y dispara `sendPreCheckinAlert` ahora,
 * sin esperar la ventana T-2h del cron.
 *
 * Útil cuando:
 *   - El check-in está a menos de 2h y el cron no llegó a alertar
 *   - El cron pospuso por quiet hours pero el gestor quiere actuar
 *   - Re-disparar después de un "NO" inicial si cambia el panorama
 */
export function PreCheckinTriggerButton({
  reservationId,
}: {
  reservationId: string;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (
      !confirm(
        "Forzar evaluación + alerta de pre-checkin ahora? Esto borra cualquier tracking previo de esta reserva.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await triggerPreCheckinNow(reservationId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const labels: Record<string, string> = {
        alert_sent: "✓ Alerta enviada al gestor",
        no_action_needed: "Ambiente OK, no se mandó alerta",
        cannot_evaluate: "No se pudo evaluar",
        quiet_hours_skipped: "Pospuesto por quiet hours",
        send_failed: "Falló el envío",
      };
      toast.success(`${labels[result.outcome] ?? result.outcome} · ${result.reason}`);
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
      <Thermometer className="mr-1 h-4 w-4" />
      {pending ? "Evaluando…" : "Acondicionar ambiente"}
    </Button>
  );
}
