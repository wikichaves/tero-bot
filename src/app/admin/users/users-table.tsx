"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UserActions } from "./user-actions";
import type { Profile, Property } from "@/lib/types";
import { ROLE_LABEL, ROLE_PRIORITY } from "@/lib/roles";
type SortKey = "name" | "email" | "role" | "properties" | "whatsapp";
const columns: { key: SortKey; className?: string }[] = [
  { key: "name", className: "w-[16%]" },
  { key: "role", className: "w-[11%]" },
  { key: "whatsapp", className: "w-[17%]" },
  { key: "email", className: "w-[25%]" },
  { key: "properties", className: "w-[23%]" },
];
export function UsersTable({ profiles, allProperties, scopedByProfile, selfId, botWhatsappNumber }: {
 profiles: Profile[]; allProperties: Pick<Property, "id" | "name">[];
 scopedByProfile: Record<string, string[]>; selfId: string; botWhatsappNumber: string | null;
}) {
 const t = useTranslations("usersPage");
 const locale = useLocale();
 const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: "role", direction: 1 });
 const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
 function value(p: Profile) {
   switch (sort.key) {
     case "name": return p.full_name ?? "";
     case "email": return p.email ?? "";
     case "role": return ROLE_LABEL[p.role];
     case "properties": return p.role === "admin" ? t("scope.all") : allProperties.filter(prop => (scopedByProfile[p.id] ?? []).includes(prop.id)).map(prop => prop.name).join(", ");
     case "whatsapp": return p.whatsapp ?? "";
   }
 }
 const sorted = [...profiles].sort((a, b) => {
   if (sort.key === "role") return (ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]) * sort.direction || collator.compare(a.full_name ?? "", b.full_name ?? "") || a.id.localeCompare(b.id);
   const av = value(a), bv = value(b);
   if (!av || !bv) return av ? -1 : bv ? 1 : a.id.localeCompare(b.id);
   return collator.compare(av, bv) * sort.direction || a.id.localeCompare(b.id);
 });
 return <>
      {/* Mobile: cards apiladas (sin scroll horizontal). Desktop: tabla. */}
      <div className="flex flex-col gap-2 md:hidden">
        {profiles.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              {t("empty")}
            </CardContent>
          </Card>
        ) : (
          sorted.map((p) => {
            const scopedIds = scopedByProfile[p.id] ?? [];
            const scopedNames = allProperties
              .filter((prop) => scopedIds.includes(prop.id))
              .map((prop) => prop.name);
            return (
              <Card key={p.id}>
                <CardContent className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-medium">{p.full_name ?? "—"}</span>
                    <span className="break-all text-xs text-muted-foreground">
                      {p.email}
                    </span>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary">{ROLE_LABEL[p.role]}</Badge>
                      {p.whatsapp && (
                        <span className="text-xs text-muted-foreground">
                          {p.whatsapp}
                        </span>
                      )}
                    </div>
                    {p.role !== "admin" && (
                      <span className="mt-0.5 text-xs text-muted-foreground">
                        {scopedNames.length === 0 ? (
                          <span className="text-status-warning">
                            {t("scope.unassigned")}
                          </span>
                        ) : (
                          scopedNames.join(", ")
                        )}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0">
                    <UserActions
                      profile={p}
                      isSelf={p.id === selfId}
                      allProperties={allProperties}
                      scopedPropertyIds={scopedIds}
                      botWhatsappNumber={botWhatsappNumber}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Card className="hidden min-w-0 md:block">
        <CardContent>
          <Table className="min-w-[860px] table-fixed">
            <TableHeader>
              <TableRow>
                {columns.map(({ key, className }) => (
                  <TableHead key={key} className={className} aria-sort={sort.key === key ? (sort.direction === 1 ? "ascending" : "descending") : "none"}>
                    <button type="button" className="flex min-h-10 items-center gap-2 text-left hover:text-foreground focus-visible:outline-2" onClick={() => setSort({ key, direction: sort.key === key && sort.direction === 1 ? -1 : 1 })}>
                      {t(`table.${key}`)}
                      {sort.key !== key ? <ArrowUpDown aria-hidden className="size-3 shrink-0" /> : sort.direction === 1 ? <ArrowUp aria-hidden className="size-3 shrink-0" /> : <ArrowDown aria-hidden className="size-3 shrink-0" />}
                    </button>
                  </TableHead>
                ))}
                <TableHead className="w-[8%] text-right">{t("table.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    {t("empty")}
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((p) => {
                  const scopedIds = scopedByProfile[p.id] ?? [];
                  const scopedNames = allProperties
                    .filter((prop) => scopedIds.includes(prop.id))
                    .map((prop) => prop.name);
                  return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium whitespace-normal">{p.full_name ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{ROLE_LABEL[p.role]}</Badge></TableCell>
                    <TableCell className="text-xs tabular-nums">{p.whatsapp ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground md:whitespace-normal [overflow-wrap:anywhere]">{p.email}</TableCell>
                    <TableCell className="text-xs md:whitespace-normal">
                      {p.role === "admin" ? <span className="text-muted-foreground">{t("scope.all")}</span> : scopedNames.length === 0 ? <span className="text-status-warning">{t("scope.unassigned")}</span> : (
                        <ul className="flex flex-wrap gap-1.5">{scopedNames.map(name => <li key={name} className="rounded-md bg-muted px-2 py-1">{name}</li>)}</ul>
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      <UserActions
                        profile={p}
                        isSelf={p.id === selfId}
                        allProperties={allProperties}
                        scopedPropertyIds={scopedIds}
                        botWhatsappNumber={botWhatsappNumber}
                      />
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
 </>;
}
