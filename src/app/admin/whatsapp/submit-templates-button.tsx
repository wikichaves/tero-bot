"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, RefreshCw, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Gestor de templates en `/admin/whatsapp` (WIK-78). Dos acciones:
 *   - "Submit a Meta" → POST submit de todas las templates
 *   - "Refresh status" → GET el estado actual del WABA
 *
 * Después de cualquier acción, muestra una tabla in-place con el
 * resultado por template. Para los rejected, el motivo se muestra con
 * tooltip + en expandible. Para submit errors, el mensaje completo
 * de Meta queda visible (no truncado).
 *
 * Auto-refresh al montar para mostrar el estado actual sin tener que
 * apretar nada.
 */

type SubmitResult = {
  name: string;
  ok: boolean;
  template_id?: string;
  status?: string;
  error?: string;
};

type StatusEntry = {
  name: string;
  status:
    | "APPROVED"
    | "PENDING"
    | "REJECTED"
    | "PAUSED"
    | "DISABLED"
    | "NOT_SUBMITTED"
    | "UNKNOWN";
  template_id: string | null;
  rejected_reason: string | null;
};

const STATUS_VARIANT: Record<StatusEntry["status"], "default" | "secondary" | "destructive" | "outline"> = {
  APPROVED: "default",
  PENDING: "secondary",
  REJECTED: "destructive",
  PAUSED: "outline",
  DISABLED: "outline",
  NOT_SUBMITTED: "outline",
  UNKNOWN: "outline",
};

export function SubmitTemplatesButton() {
  const t = useTranslations("adminWhatsappSubmit");
  const [pending, startTransition] = useTransition();
  const [statusPending, startStatus] = useTransition();
  const [submitResults, setSubmitResults] = useState<SubmitResult[] | null>(
    null,
  );
  const [status, setStatus] = useState<StatusEntry[] | null>(null);

  function refreshStatus() {
    startStatus(async () => {
      try {
        const res = await fetch("/api/admin/whatsapp/templates-status");
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error ?? `HTTP ${res.status}`);
          return;
        }
        setStatus(json.entries ?? []);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  // Auto-load status al montar.
  useEffect(() => {
    refreshStatus();
  }, []);

  function onSubmit() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/whatsapp/submit-templates", {
          method: "POST",
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error ?? `HTTP ${res.status}`);
          return;
        }
        setSubmitResults(json.results ?? []);
        toast.success(
          t("toast.submitSummary", {
            submitted: json.submitted,
            failed: json.failed,
            total: json.total,
          }),
        );
        // Re-pull status para que se actualice.
        refreshStatus();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <div className="flex w-full max-w-lg flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button
          onClick={refreshStatus}
          disabled={statusPending}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={`mr-1 h-4 w-4 ${statusPending ? "animate-spin" : ""}`}
          />
          {statusPending ? t("buttons.refreshing") : t("buttons.refreshStatus")}
        </Button>
        <Button onClick={onSubmit} disabled={pending} size="sm">
          <Send className="mr-1 h-4 w-4" />
          {pending ? t("buttons.submitting") : t("buttons.submitToMeta")}
        </Button>
      </div>

      {status && status.length > 0 && (
        <div className="w-full rounded-md border bg-card p-3 text-xs">
          <p className="mb-2 font-medium">{t("headings.metaStatus")}</p>
          <ul className="flex flex-col gap-1.5">
            {status.map((r) => (
              <li key={r.name} className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono">{r.name}</span>
                  <Badge
                    variant={STATUS_VARIANT[r.status]}
                    className="text-[10px]"
                  >
                    {r.status === "APPROVED" && (
                      <CheckCircle2 className="mr-1 inline h-3 w-3" />
                    )}
                    {r.status === "REJECTED" && (
                      <XCircle className="mr-1 inline h-3 w-3" />
                    )}
                    {r.status}
                    {r.template_id ? ` · ${r.template_id.slice(0, 8)}` : ""}
                  </Badge>
                </div>
                {r.rejected_reason && (
                  <p className="text-[10px] italic text-destructive">
                    {r.rejected_reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {submitResults && submitResults.length > 0 && (
        <div className="w-full rounded-md border bg-card p-3 text-xs">
          <p className="mb-2 font-medium">{t("headings.lastSubmit")}</p>
          <ul className="flex flex-col gap-1.5">
            {submitResults.map((r) => (
              <li key={r.name} className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono">{r.name}</span>
                  {r.ok ? (
                    <Badge variant="default" className="text-[10px]">
                      {r.status ?? t("badges.submitted")}
                      {r.template_id
                        ? ` · ${r.template_id.slice(0, 8)}`
                        : ""}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">
                      {t("badges.failed")}
                    </Badge>
                  )}
                </div>
                {!r.ok && r.error && (
                  <pre className="overflow-x-auto whitespace-pre-wrap text-[10px] text-destructive">
                    {r.error}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
