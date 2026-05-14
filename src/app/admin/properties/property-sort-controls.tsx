"use client";

import { useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { moveProperty } from "./actions";

/**
 * Up/down chevrons to reorder a property in /admin/properties. Each click
 * swaps `sort_order` with the adjacent row. Disabled at the boundary so
 * the user gets visual feedback when there's nowhere else to go.
 */
export function PropertySortControls({
  propertyId,
  isFirst,
  isLast,
}: {
  propertyId: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function move(direction: "up" | "down") {
    startTransition(async () => {
      const result = await moveProperty(propertyId, direction);
      if ("error" in result && result.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        aria-label="Subir"
        disabled={pending || isFirst}
        onClick={() => move("up")}
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
        onClick={() => move("down")}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
