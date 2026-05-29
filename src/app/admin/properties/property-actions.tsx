"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { Property } from "@/lib/types";
import { deleteProperty, syncProperty } from "./actions";
import { EditPropertyDialog } from "./property-form-dialog";

export function PropertyActions({ property }: { property: Property }) {
  const t = useTranslations("adminPropertyActions");
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  function sync() {
    if (!property.airbnb_ical_url) {
      toast.error(t("toast.noAirbnbUrl"));
      return;
    }
    startTransition(async () => {
      const r = await syncProperty(property.id);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      const {
        reservations,
        blocks,
        codes_generated,
        cleaning_tasks_created,
        errors,
      } = r.result;
      const parts = [
        t("toast.reservations", { count: reservations }),
        t("toast.blocks", { count: blocks }),
      ];
      if (codes_generated > 0) {
        parts.push(t("toast.codesGenerated", { count: codes_generated }));
      }
      if (cleaning_tasks_created > 0) {
        parts.push(
          t("toast.cleaningTasks", { count: cleaning_tasks_created }),
        );
      }
      const summary = parts.join(", ");
      if (errors.length > 0) {
        toast.warning(
          t("toast.syncedWithErrors", { summary, errors: errors.length }),
        );
      } else {
        toast.success(t("toast.synced", { summary }));
      }
    });
  }

  function remove() {
    if (!confirm(t("confirm.delete", { name: property.name }))) {
      return;
    }
    startTransition(async () => {
      const r = await deleteProperty(property.id);
      if (r?.error) {
        toast.error(r.error);
        return;
      }
      toast.success(t("toast.deleted"));
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" disabled={pending} />}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            {t("menu.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={sync}
            disabled={!property.airbnb_ical_url || pending}
          >
            {t("menu.syncAirbnb")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={remove}
            className="text-destructive focus:text-destructive"
          >
            {t("menu.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditPropertyDialog
        property={property}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
