"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Property, Task, UserRole } from "@/lib/types";
import { deleteTask, setTaskStatus } from "./actions";
import { EditTaskDialog } from "./task-form-dialog";

type AssigneeProfile = {
  id: string;
  full_name: string | null;
  email: string;
  role: UserRole;
};

export function TaskRowActions({
  task,
  properties,
  assignees,
  isAdmin,
}: {
  task: Task;
  properties: Pick<Property, "id" | "name">[];
  assignees: AssigneeProfile[];
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  function setStatus(status: Task["status"]) {
    startTransition(async () => {
      const r = await setTaskStatus({ id: task.id, status });
      if (r?.error) toast.error(r.error);
      else toast.success("Estado actualizado.");
    });
  }

  function remove() {
    if (!confirm(`¿Eliminar la tarea "${task.title}"?`)) return;
    startTransition(async () => {
      const r = await deleteTask(task.id);
      if (r?.error) toast.error(r.error);
      else toast.success("Tarea eliminada.");
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
            Editar
          </DropdownMenuItem>
          {/* WIK-104: simplificación a 2 estados visibles (pendiente /
              hecha). "Marcar en curso" eliminado del menu — el dato
              sigue en DB para tareas legacy pero el user no lo elige. */}
          {task.status !== "done" && (
            <DropdownMenuItem onClick={() => setStatus("done")}>
              Marcar hecha
            </DropdownMenuItem>
          )}
          {task.status === "done" && (
            <DropdownMenuItem onClick={() => setStatus("pending")}>
              Reabrir
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={remove}
                className="text-destructive focus:text-destructive"
              >
                Eliminar
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <EditTaskDialog
        task={task}
        properties={properties}
        assignees={assignees}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
