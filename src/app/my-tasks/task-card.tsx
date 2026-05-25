"use client";

import { useTransition } from "react";
import { parseISO } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, PlayCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Task } from "@/lib/types";
import { extractPhotos } from "@/lib/tasks/format";
import { formatDayShortDate } from "@/lib/i18n/date";
import { markOwnTaskStatus } from "./actions";

// WIK-163: status badge variant queda en mapping (no es texto traducible
// — controla el color). Los labels de status/kind se resuelven via t()
// abajo.
const STATUS_BADGE: Record<Task["status"], "default" | "secondary" | "outline"> = {
  pending: "secondary",
  in_progress: "default",
  done: "outline",
};

type MyTask = Task & {
  property: { id: string; name: string } | null;
};

export function MyTaskCard({ task }: { task: MyTask }) {
  const [pending, startTransition] = useTransition();
  // WIK-163/164: traducciones de labels (kind/status) y de los botones
  // (start/markDone/reopen). El "Vencida"/"Vence" del due-line también
  // se traduce, y la fecha se formatea con formatTaskDueDate del helper
  // i18n que acepta el locale activo.
  const tKind = useTranslations("tasks.kind");
  const tStatus = useTranslations("tasks.status");
  const tActions = useTranslations("tasks.actions");
  const tOverdue = useTranslations("tasks");
  const locale = useLocale();
  const todayIso = new Date().toISOString().slice(0, 10);
  const isOverdue =
    task.status !== "done" && !!task.due_date && task.due_date < todayIso;
  const { urls: photoUrls, cleaned: cleanedDescription } = extractPhotos(
    task.description,
  );

  function setStatus(status: Task["status"]) {
    startTransition(async () => {
      const r = await markOwnTaskStatus({ id: task.id, status });
      if (r?.error) toast.error(r.error);
      else toast.success("OK");
    });
  }

  return (
    <Card className={isOverdue ? "border-destructive" : undefined}>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg leading-tight">
              {task.title}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{task.property?.name ?? "—"}</span>
              <span>·</span>
              <Badge variant="outline">{tKind(task.kind)}</Badge>
              {task.due_date && (
                <>
                  <span>·</span>
                  <span
                    className={
                      isOverdue ? "text-destructive font-medium" : ""
                    }
                  >
                    {isOverdue
                      ? `${tOverdue("overdue")} `
                      : ""}
                    {formatDayShortDate(parseISO(task.due_date), locale)}
                  </span>
                </>
              )}
            </div>
          </div>
          <Badge variant={STATUS_BADGE[task.status]}>
            {tStatus(task.status)}
          </Badge>
        </div>

        {cleanedDescription && (
          <p className="whitespace-pre-line text-sm text-muted-foreground">
            {cleanedDescription}
          </p>
        )}

        {photoUrls.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {photoUrls.map((url, i) => (
              <a
                key={`${url}-${i}`}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-md border bg-muted"
                title="Abrir foto"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Foto adjunta ${i + 1}`}
                  className="h-32 w-full object-cover"
                />
              </a>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {task.status === "pending" && (
            <>
              <Button
                onClick={() => setStatus("in_progress")}
                disabled={pending}
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                {tActions("start")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setStatus("done")}
                disabled={pending}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {tActions("markDone")}
              </Button>
            </>
          )}
          {task.status === "in_progress" && (
            <Button
              onClick={() => setStatus("done")}
              disabled={pending}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {tActions("markDone")}
            </Button>
          )}
          {task.status === "done" && (
            <Button
              variant="outline"
              onClick={() => setStatus("pending")}
              disabled={pending}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {tActions("reopen")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
