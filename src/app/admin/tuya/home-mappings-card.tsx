"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Property } from "@/lib/types";
import { saveTuyaHomeMapping } from "./actions";

/**
 * Card de mapping de Tuya homes → property (WIK-95).
 *
 * Resuelve el caso donde el nombre del home Tuya no matchea ninguna
 * property (ej. "Casa Bosque" agrupa devices de varias casas). El admin
 * elige manualmente la property destino (o "ignorar este home") y se
 * persiste en `tuya_home_overrides`. El sync respeta el override.
 *
 * El card SOLO se muestra para admins. Visible aunque el sync funcione
 * con nombres — útil para overrides explícitos cuando se necesite.
 */

type HomeRow = {
  tuya_home_id: string;
  home_name: string;
  current_property_id: string | null;
  is_override: boolean;
  /** Property resuelta actualmente — sea por override o por name-match.
   *  null = no resuelve a ninguna (sync skipearía). */
  resolved_property_name: string | null;
};

const IGNORE = "__ignore__";
const AUTO = "__auto__";

export function HomeMappingsCard({
  homes,
  properties,
}: {
  homes: HomeRow[];
  properties: Pick<Property, "id" | "name">[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Selección por home: undefined = sin cambios; valor = property_id, IGNORE o AUTO.
  const [selections, setSelections] = useState<Map<string, string>>(
    new Map(),
  );

  function setSelection(homeId: string, value: string) {
    setSelections((prev) => {
      const next = new Map(prev);
      next.set(homeId, value);
      return next;
    });
  }

  function onSave() {
    if (selections.size === 0) {
      toast.info("Sin cambios para guardar.");
      return;
    }
    startTransition(async () => {
      const updates = Array.from(selections.entries()).map(([homeId, val]) => ({
        homeId,
        // AUTO → null (remover override), IGNORE → "" sentinel para "ignorar",
        // UUID → setear esa property.
        action: (val === AUTO
          ? "remove"
          : val === IGNORE
            ? "ignore"
            : "set") as "remove" | "ignore" | "set",
        propertyId: val === AUTO || val === IGNORE ? null : val,
      }));
      let errors = 0;
      for (const u of updates) {
        const r = await saveTuyaHomeMapping(u);
        if (r?.error) {
          toast.error(`${u.homeId}: ${r.error}`);
          errors++;
        }
      }
      if (errors === 0) {
        toast.success(`${updates.length} mapping(s) guardado(s).`);
        setSelections(new Map());
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mapping de homes Tuya</CardTitle>
        <CardDescription>
          Si un home en Smart Life no corresponde 1:1 con una property (ej.
          un home llamado &ldquo;Casa Bosque&rdquo; que agrupa devices de varias
          casas), asignalo manualmente acá. El sync respeta este mapping
          y los devices/rooms del home van a la property elegida.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {homes.map((h) => {
          const currentDisplay = h.is_override
            ? h.current_property_id == null
              ? "ignorar"
              : (h.resolved_property_name ?? "?")
            : h.resolved_property_name
              ? `${h.resolved_property_name} (auto por nombre)`
              : "— sin asignar";
          const selectedValue =
            selections.get(h.tuya_home_id) ??
            (h.is_override
              ? h.current_property_id ?? IGNORE
              : AUTO);
          return (
            <div
              key={h.tuya_home_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium">{h.home_name}</span>
                <span className="text-xs text-muted-foreground">
                  Tuya home_id: <code>{h.tuya_home_id}</code> · Estado:{" "}
                  {currentDisplay}
                </span>
              </div>
              <select
                value={selectedValue}
                onChange={(e) => setSelection(h.tuya_home_id, e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                <option value={AUTO}>— Auto (por nombre) —</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value={IGNORE}>Ignorar este home</option>
              </select>
            </div>
          );
        })}
        {homes.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No hay homes detectados en Tuya.
          </p>
        )}
        <div className="flex justify-end pt-2">
          <Button
            onClick={onSave}
            disabled={pending || selections.size === 0}
            size="sm"
          >
            <Save className="mr-1 h-4 w-4" />
            {pending
              ? "Guardando…"
              : selections.size > 0
                ? `Guardar (${selections.size})`
                : "Sin cambios"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
