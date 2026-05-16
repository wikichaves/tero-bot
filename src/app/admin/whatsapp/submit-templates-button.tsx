"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Botón para submitar las templates a Kapso/Meta (WIK-78). Llama al
 * endpoint `/api/admin/whatsapp/submit-templates`. Después muestra una
 * tabla in-place con el resultado por template — template_id si OK,
 * error message si falló (típicamente "duplicate" cuando ya estaba).
 */

type Result = {
  name: string;
  ok: boolean;
  template_id?: string;
  status?: string;
  error?: string;
};

export function SubmitTemplatesButton() {
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<Result[] | null>(null);

  function onClick() {
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
        setResults(json.results ?? []);
        toast.success(
          `${json.submitted} submitted, ${json.failed} failed (de ${json.total} total).`,
        );
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={onClick} disabled={pending} size="sm">
        <Send className="mr-1 h-4 w-4" />
        {pending ? "Enviando…" : "Submit a Meta"}
      </Button>
      {results && (
        <div className="w-full max-w-md rounded-md border bg-card p-2 text-xs">
          <p className="mb-1 font-medium">Último submit:</p>
          <ul className="flex flex-col gap-1">
            {results.map((r) => (
              <li key={r.name} className="flex items-baseline justify-between gap-2">
                <span className="font-mono">{r.name}</span>
                {r.ok ? (
                  <Badge variant="default" className="text-[10px]">
                    {r.status ?? "submitted"}
                    {r.template_id ? ` · ${r.template_id.slice(0, 8)}` : ""}
                  </Badge>
                ) : (
                  <span
                    className="text-right text-[10px] text-destructive"
                    title={r.error}
                  >
                    {(r.error ?? "").slice(0, 60)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
