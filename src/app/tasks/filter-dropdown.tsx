"use client";

import Link from "next/link";
import { ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Dropdown genérico de filtro (WIK-116 / WIK-244). Originalmente solo
 * para propiedad; ahora también se usa para el filtro "Asignado".
 *
 * Las options se pre-computan en el server (URLs con los demás filtros
 * preservados) porque Next no serializa funciones server → client. La
 * primera option es siempre el "Todas/Todos".
 *
 * `label` es el prefijo visible (ej. "Propiedad:" / "Asignado:") — viene
 * traducido del parent (server component con getTranslations).
 */

export type FilterOption = {
  /** id de la option. null o un sentinel ("unassigned") según el caso. */
  id: string | null;
  label: string;
  href: string;
};

export function FilterDropdown({
  label,
  options,
  currentId,
}: {
  label: string;
  options: FilterOption[];
  currentId: string | null;
}) {
  const currentLabel =
    options.find((o) => o.id === currentId)?.label ??
    options[0]?.label ??
    "";

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
            />
          }
        >
          <span>{currentLabel}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          {options.map((opt, idx) => {
            const key = opt.id ?? "__all__";
            return (
              <div key={key}>
                <DropdownMenuItem render={<Link href={opt.href} />}>
                  <Check
                    className={`mr-2 h-4 w-4 ${
                      currentId === opt.id ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  {opt.label}
                </DropdownMenuItem>
                {idx === 0 && options.length > 1 && <DropdownMenuSeparator />}
              </div>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
