"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { Property, Task, UserRole } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/roles";
import { createTask, updateTask } from "./actions";

const KIND_OPTIONS: { value: Task["kind"]; label: string }[] = [
  { value: "limpieza", label: "Limpieza" },
  { value: "mantenimiento", label: "Mantenimiento" },
  { value: "insumos", label: "Insumos" },
  { value: "otro", label: "Otro" },
];

const STATUS_OPTIONS: { value: Task["status"]; label: string }[] = [
  { value: "pending", label: "Pendiente" },
  { value: "in_progress", label: "En curso" },
  { value: "done", label: "Hecha" },
];

type AssigneeProfile = {
  id: string;
  full_name: string | null;
  email: string;
  role: UserRole;
};

export function NewTaskDialog({
  properties,
  assignees,
  defaultPropertyId,
}: {
  properties: Pick<Property, "id" | "name">[];
  assignees: AssigneeProfile[];
  defaultPropertyId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>Nueva tarea</DialogTrigger>
      <DialogContent>
        <TaskForm
          properties={properties}
          assignees={assignees}
          defaultPropertyId={defaultPropertyId}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EditTaskDialog({
  task,
  properties,
  assignees,
  open,
  onOpenChange,
}: {
  task: Task;
  properties: Pick<Property, "id" | "name">[];
  assignees: AssigneeProfile[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* key={task.id} re-mounts the form when switching between tasks,
            so we can derive initial state from props in useState() instead
            of syncing it inside a useEffect. */}
        <TaskForm
          key={task.id}
          task={task}
          properties={properties}
          assignees={assignees}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  task,
  properties,
  assignees,
  defaultPropertyId,
  onDone,
}: {
  task?: Task;
  properties: Pick<Property, "id" | "name">[];
  assignees: AssigneeProfile[];
  defaultPropertyId?: string;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [propertyId, setPropertyId] = useState(
    task?.property_id ?? defaultPropertyId ?? properties[0]?.id ?? "",
  );
  const [kind, setKind] = useState<Task["kind"]>(task?.kind ?? "limpieza");
  const [status, setStatus] = useState<Task["status"]>(
    task?.status ?? "pending",
  );
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [assignedTo, setAssignedTo] = useState(task?.assigned_to ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  // WIK-124: vencimiento con hora opcional + alarma WhatsApp X horas antes.
  // due_time es HH:MM. Input HTML `time` devuelve eso directamente.
  const [dueTime, setDueTime] = useState(task?.due_time ?? "");
  const [alarmEnabled, setAlarmEnabled] = useState(
    task?.alarm_hours_before != null,
  );
  const [alarmHoursBefore, setAlarmHoursBefore] = useState<string>(
    task?.alarm_hours_before != null ? String(task.alarm_hours_before) : "2",
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!propertyId) {
      toast.error("Elegí una propiedad.");
      return;
    }
    // WIK-124: alarma requiere due_date (no podemos saber cuándo mandar
    // el recordatorio sin la fecha). due_time es opcional — si no, el
    // cron asume medianoche local.
    if (alarmEnabled && !dueDate) {
      toast.error("Para activar la alarma necesitás definir una fecha de vencimiento.");
      return;
    }
    const hoursNum = alarmEnabled ? Number(alarmHoursBefore) : null;
    if (alarmEnabled && (!Number.isFinite(hoursNum!) || hoursNum! <= 0)) {
      toast.error("Horas antes de la alarma debe ser un número positivo.");
      return;
    }
    startTransition(async () => {
      const payload = {
        property_id: propertyId,
        kind,
        title,
        description,
        assigned_to: assignedTo,
        due_date: dueDate,
        due_time: dueTime,
        // null si checkbox off → el server desactiva la alarma (col=null)
        alarm_hours_before: alarmEnabled ? hoursNum : null,
      };
      const result = task
        ? await updateTask({ ...payload, id: task.id, status })
        : await createTask(payload);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(task ? "Tarea actualizada." : "Tarea creada.");
      onDone();
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>{task ? "Editar tarea" : "Nueva tarea"}</DialogTitle>
        <DialogDescription>
          Asigná una tarea a un usuario del personal o dejala sin asignar
          para retomarla más tarde.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="title">Título</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
            placeholder="ej. Limpieza salida huésped"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="property_id">Propiedad</Label>
            <select
              id="property_id"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              required
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              <option value="">— elegí —</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="kind">Tipo</Label>
            <select
              id="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as Task["kind"])}
              required
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              {KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="assigned_to">Asignar a</Label>
            <select
              id="assigned_to"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              <option value="">Sin asignar</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name ?? a.email} ({ROLE_LABEL[a.role]})
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="due_date">Vence (opcional)</Label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input
                id="due_date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              {/* WIK-124: hora del día, opcional. Solo tiene sentido si
                  hay due_date — si el user limpia la fecha también
                  limpiamos la hora para evitar estado inconsistente. */}
              <Input
                aria-label="Hora de vencimiento"
                type="time"
                value={dueTime}
                disabled={!dueDate}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-[7.5rem]"
              />
            </div>
          </div>
        </div>
        {/* WIK-124: alarma WhatsApp X horas antes. Solo se habilita el
            input numérico cuando el checkbox está prendido. Default 2h. */}
        <div className="grid gap-2 rounded-md border border-input bg-muted/30 p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={alarmEnabled}
              onChange={(e) => setAlarmEnabled(e.target.checked)}
              className="h-4 w-4"
              disabled={!dueDate}
            />
            Enviar alarma por WhatsApp antes del vencimiento
          </label>
          {alarmEnabled && (
            <div className="flex items-center gap-2 pl-6 text-sm">
              <Input
                type="number"
                min={1}
                max={168}
                value={alarmHoursBefore}
                onChange={(e) => setAlarmHoursBefore(e.target.value)}
                className="w-20"
                aria-label="Horas antes de la alarma"
              />
              <span>horas antes (se envía al asignado)</span>
            </div>
          )}
          {!dueDate && (
            <p className="text-xs text-muted-foreground">
              Definí una fecha de vencimiento para activar la alarma.
            </p>
          )}
        </div>
        {task && (
          <div className="grid gap-2">
            <Label htmlFor="status">Estado</Label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as Task["status"])}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="description">Descripción</Label>
          <textarea
            id="description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalles adicionales (opcional)"
            className="resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
