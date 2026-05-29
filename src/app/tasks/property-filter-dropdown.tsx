"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
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
 * Dropdown para filtrar tareas por propiedad (WIK-116). Reemplaza
 * los pills horizontales que no escalaban con muchas properties.
 *
 * Recibe el listado de options pre-computadas en el server porque
 * Next no permite pasar funciones de server → client component
 * (las funciones no son serializables). Cada option incluye su
 * `href` ya armado con los filtros que el padre conservó.
 */

export type PropertyFilterOption = {
  /** null = "Todas" (sin filtro). UUID si es una property específica. */
  id: string | null;
  label: string;
  href: string;
};

export function PropertyFilterDropdown({
  options,
  currentId,
}: {
  options: PropertyFilterOption[];
  currentId: string | null;
}) {
  const t = useTranslations("tasksPropertyFilter");
  const currentLabel =
    options.find((o) => o.id === currentId)?.label ?? t("all");

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{t("label")}</span>
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
