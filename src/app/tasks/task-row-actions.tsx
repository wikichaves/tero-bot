"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { markOwnTaskStatus } from "@/app/my-tasks/actions";
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
  role,
  currentUserId,
}: {
  task: Task;
  properties: Pick<Property, "id" | "name">[];
  assignees: AssigneeProfile[];
  /** WIK-251: rol del que mira — define qué acciones se muestran. */
  role: UserRole;
  /** WIK-251: id del que mira — para que Staff cambie el estado de SUS
   *  tareas vía markOwnTaskStatus. */
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  // WIK-164: textos del menú via next-intl. `tasks.actions.*` para
  // las acciones; el confirm() reusa la misma key.
  const tActions = useTranslations("tasks.actions");

  // WIK-251: Admin y Manager pueden editar/borrar (la lista ya viene
  // scopeada a sus propiedades). Staff solo puede cambiar el estado de las
  // tareas asignadas a él.
  const canManage = role === "admin" || role === "gestor";
  const canSetOwnStatus =
    role === "mantenimiento" && task.assigned_to === currentUserId;
  const canChangeStatus = canManage || canSetOwnStatus;

  function setStatus(status: Task["status"]) {
    startTransition(async () => {
      // Manager/Admin → setTaskStatus (scope validado en la action).
      // Staff → markOwnTaskStatus (solo sus tareas asignadas).
      const r = canManage
        ? await setTaskStatus({ id: task.id, status })
        : await markOwnTaskStatus({ id: task.id, status });
      if (r?.error) toast.error(r.error);
      else toast.success("OK");
    });
  }

  // Si no hay ninguna acción disponible para este rol/tarea, no
  // renderizamos el menú (evita un dropdown vacío).
  if (!canManage && !canChangeStatus) return null;

  function remove() {
    if (!confirm(tActions("confirmDelete"))) return;
    startTransition(async () => {
      const r = await deleteTask(task.id);
      if (r?.error) toast.error(r.error);
      else toast.success("OK");
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
          {/* WIK-251: editar solo Admin/Manager. */}
          {canManage && (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              {tActions("edit")}
            </DropdownMenuItem>
          )}
          {/* WIK-104: simplificación a 2 estados visibles (pendiente /
              hecha). "Marcar en curso" eliminado del menu — el dato
              sigue en DB para tareas legacy pero el user no lo elige.
              WIK-251: cambiar estado lo puede hacer Admin/Manager (cualquier
              tarea de su scope) o Staff sobre SUS tareas asignadas. */}
          {canChangeStatus && task.status !== "done" && (
            <DropdownMenuItem onClick={() => setStatus("done")}>
              {tActions("markDone")}
            </DropdownMenuItem>
          )}
          {canChangeStatus && task.status === "done" && (
            <DropdownMenuItem onClick={() => setStatus("pending")}>
              {tActions("reopen")}
            </DropdownMenuItem>
          )}
          {/* WIK-251: borrar solo Admin/Manager (Manager limitado a sus
              propiedades, validado en la action). */}
          {canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={remove}
                className="text-destructive focus:text-destructive"
              >
                {tActions("delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* El diálogo de edición solo se monta para quien puede editar. */}
      {canManage && (
        <EditTaskDialog
          task={task}
          properties={properties}
          assignees={assignees}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </>
  );
}
