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
 * Dropdown para filtrar tareas por propiedad (WIK-116). Reemplaza
 * los pills "Todas / Casa A / Casa B / ..." que se acumulaban
 * horizontalmente y no escalaban bien cuando había muchas properties.
 *
 * Default visual: "Propiedad: Todas". Cuando hay un filtro activo,
 * muestra el nombre de la property seleccionada.
 *
 * Cada item es un Link normal para preservar el patrón server-side
 * que usa el resto del page (filtros como query params).
 */
export function PropertyFilterDropdown({
  properties,
  current,
  buildHref,
}: {
  properties: Array<{ id: string; name: string }>;
  current: string | null;
  /** Helper que genera la URL para un property_id determinado
   *  (null = "todas"). El padre lo arma con los demás filtros
   *  preservados. */
  buildHref: (propertyId: string | null) => string;
}) {
  const currentName =
    current == null
      ? "Todas"
      : (properties.find((p) => p.id === current)?.name ?? "Todas");

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">Propiedad:</span>
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
          <span>{currentName}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          <DropdownMenuItem render={<Link href={buildHref(null)} />}>
            <Check
              className={`mr-2 h-4 w-4 ${current == null ? "opacity-100" : "opacity-0"}`}
            />
            Todas
          </DropdownMenuItem>
          {properties.length > 0 && <DropdownMenuSeparator />}
          {properties.map((p) => (
            <DropdownMenuItem
              key={p.id}
              render={<Link href={buildHref(p.id)} />}
            >
              <Check
                className={`mr-2 h-4 w-4 ${current === p.id ? "opacity-100" : "opacity-0"}`}
              />
              {p.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
