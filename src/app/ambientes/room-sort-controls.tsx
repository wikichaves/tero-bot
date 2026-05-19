"use client";

import { useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { moveRoom } from "./actions";

/**
 * Chevrons arriba/abajo para reordenar un room en /ambientes (WIK-98).
 * Cada click swappea el `sort_order` con el vecino dentro de la misma
 * property. Disabled en el borde para feedback visual.
 *
 * Diseño: el wrapper en page.tsx posiciona estos chevrons absolute en
 * el corner de la card. `stopPropagation` + `preventDefault` evitan
 * que el click bubble al Link que envuelve la card.
 */
export function RoomSortControls({
  roomId,
  isFirst,
  isLast,
}: {
  roomId: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function move(e: React.MouseEvent, direction: "up" | "down") {
    // El wrapper Link captura el click — paramos el bubble + nav.
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      const result = await moveRoom(roomId, direction);
      if ("error" in result && result.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-background/80 p-0.5 shadow-sm backdrop-blur">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        aria-label="Subir"
        disabled={pending || isFirst}
        onClick={(e) => move(e, "up")}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        aria-label="Bajar"
        disabled={pending || isLast}
        onClick={(e) => move(e, "down")}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
