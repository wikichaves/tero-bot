"use client";

import { useTransition } from "react";
import { ChevronLeft, ChevronRight, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { moveRoom } from "./actions";

/**
 * 3-dots dropdown para reordenar un room en /ambientes (WIK-98 v2).
 *
 * El primer intento usaba chevrons absolute en el corner — pero tapaban
 * el badge de "N sensores" y los clicks se confundían con el Link
 * wrapper de la card.
 *
 * Solución: dropdown trigger al lado del badge en el CardTitle (no
 * dentro del Link). Items "Mover izquierda" / "Mover derecha" se mapean
 * a moveRoom("up"|"down") en la action (el grid es row-major
 * left-to-right, así que "izquierda" == sort_order menor).
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

  function move(direction: "up" | "down") {
    startTransition(async () => {
      const result = await moveRoom(roomId, direction);
      if ("error" in result && result.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // base-ui usa `render={<...>}` para componer el trigger sobre un
        // elemento custom (en Radix sería `asChild`). El onClick evita
        // que el click navegue al detalle (la card está envuelta en Link).
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label="Reordenar"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        }
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={isFirst || pending}
          onClick={() => move("up")}
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          Mover a la izquierda
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isLast || pending}
          onClick={() => move("down")}
        >
          <ChevronRight className="mr-2 h-4 w-4" />
          Mover a la derecha
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
