"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
import type { Property, Task } from "@/lib/types";
import { reportTask } from "./actions";

const KIND_OPTIONS: { value: Task["kind"]; label: string }[] = [
  { value: "mantenimiento", label: "Mantenimiento" },
  { value: "limpieza", label: "Limpieza" },
  { value: "insumos", label: "Insumos" },
  { value: "otro", label: "Otro" },
];

export function ReportTaskDialog({
  properties,
}: {
  properties: Pick<Property, "id" | "name">[];
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("myTasksPage");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>{t("report")}</DialogTrigger>
      <DialogContent>
        <ReportForm
          properties={properties}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReportForm({
  properties,
  onDone,
}: {
  properties: Pick<Property, "id" | "name">[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("myTasksPage.form");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<Task["kind"]>("mantenimiento");
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!propertyId) {
      toast.error("Elegí una propiedad.");
      return;
    }
    startTransition(async () => {
      const result = await reportTask({
        title,
        description,
        kind,
        property_id: propertyId,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Tarea creada y asignada a vos.");
      // Reset for next report.
      setTitle("");
      setDescription("");
      setKind("mantenimiento");
      onDone();
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>
          La tarea queda asignada a vos. Si querés reasignarla a otro,
          editala desde la lista global de tareas.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="title">{t("labelTitle")}</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
            placeholder="ej. Cambiar bombilla baño"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="property_id">{t("labelProperty")}</Label>
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
            <Label htmlFor="kind">{t("labelKind")}</Label>
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
        <div className="grid gap-2">
          <Label htmlFor="description">Descripción (opcional)</Label>
          <textarea
            id="description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalles adicionales"
            className="resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? t("submitting") : t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
