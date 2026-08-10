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
    <div className="flex w-full flex-col gap-4">
      {/* Acciones: compactas, alineadas a la derecha. */}
      <div className="flex justify-end gap-2">
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

      {/* Panel de status: ancho completo, grilla responsive. Cada template
          es una card con jerarquía clara (nombre primario, meta secundaria). */}
      {status && status.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t("headings.metaStatus")}</p>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {status.map((r) => (
              <li
                key={`${r.name}|${r.language ?? ""}`}
                className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-all font-mono text-sm">
                    {r.name}
                    {r.language && (
                      <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {r.language}
                      </span>
                    )}
                  </span>
                  <Badge
                    variant={STATUS_VARIANT[r.status]}
                    className="shrink-0 text-[10px]"
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
                {/* WIK-316: categoría real en Meta. Si difiere de la declarada,
                    la resaltamos: un UTILITY re-categorizado a MARKETING deja
                    de entregar fuera de la ventana 24h aunque siga APPROVED. */}
                {r.category && (
                  <p
                    className={
                      r.category_mismatch
                        ? "text-xs font-medium text-destructive"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {r.category_mismatch
                      ? `⚠ Meta la re-categorizó: ${r.local_category} → ${r.category} (puede no entregar fuera de la ventana 24h)`
                      : `${r.category}`}
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
        </div>
      )}

      {submitResults && submitResults.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t("headings.lastSubmit")}</p>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {submitResults.map((r) => (
              <li
                key={r.name}
                className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-all font-mono text-sm">
                    {r.name}
                  </span>
                  {r.ok ? (
                    <Badge variant="default" className="shrink-0 text-[10px]">
                      {r.status ?? t("badges.submitted")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="shrink-0 text-[10px]">
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
        </div>
      )}
    </div>
  );
}
