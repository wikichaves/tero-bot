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
  /** WIK-320: idioma de la variante — cada una se aprueba por separado. */
  language?: string;
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
  /** WIK-316: categoría real en Meta vs. la que declaramos localmente. */
  category?: string | null;
  local_category?: string | null;
  category_mismatch?: boolean;
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
    <div className="flex w-full flex-col gap-5">
      {/* Acciones */}
      <div className="flex flex-wrap justify-end gap-2">
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

      {/* Status en Meta — grilla responsive a ancho completo */}
      {status && status.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("headings.metaStatus")}
          </h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {status.map((r) => (
              <li
                key={`${r.name}|${r.language ?? ""}`}
                className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="min-w-0 break-all font-mono text-sm font-medium">
                      {r.name}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {r.language && (
                        <span className="uppercase">{r.language}</span>
                      )}
                      {r.category && (
                        <>
                          {r.language && <span aria-hidden>·</span>}
                          <span
                            className={
                              r.category_mismatch
                                ? "font-medium text-destructive"
                                : ""
                            }
                          >
                            {r.category}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant={STATUS_VARIANT[r.status]}
                    className="shrink-0"
                  >
                    {r.status === "APPROVED" && (
                      <CheckCircle2 className="mr-1 inline h-3 w-3" />
                    )}
                    {r.status === "REJECTED" && (
                      <XCircle className="mr-1 inline h-3 w-3" />
                    )}
                    {r.status}
                  </Badge>
                </div>
                {r.category_mismatch && (
                  <p className="text-xs font-medium text-destructive">
                    {t("categoryMismatch", {
                      from: r.local_category ?? "",
                      to: r.category ?? "",
                    })}
                  </p>
                )}
                {r.rejected_reason && (
                  <p className="text-xs italic text-destructive">
                    {r.rejected_reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {submitResults && submitResults.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("headings.lastSubmit")}
          </h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {submitResults.map((r) => (
              <li
                key={r.name}
                className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-all font-mono text-sm font-medium">
                    {r.name}
                  </span>
                  {r.ok ? (
                    <Badge variant="default" className="shrink-0">
                      {r.status ?? t("badges.submitted")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="shrink-0">
                      {t("badges.failed")}
                    </Badge>
                  )}
                </div>
                {!r.ok && r.error && (
                  <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-destructive">
                    {r.error}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
