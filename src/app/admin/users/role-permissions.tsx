import { getTranslations } from "next-intl/server";
import { ROLE_LABEL, ROLE_PRIORITY } from "@/lib/roles";
import type { UserRole } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export async function RolePermissions() {
  const t = await getTranslations("usersPage.permissions");
  const roles = (Object.keys(ROLE_PRIORITY) as UserRole[]).sort((a, b) => ROLE_PRIORITY[a] - ROLE_PRIORITY[b]);
  return <section aria-labelledby="role-permissions-title" className="min-w-0 space-y-3">
    <h2 id="role-permissions-title" className="text-2xl">{t("title")}</h2>
    <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
    <Card><CardContent><Table className="min-w-[720px] table-fixed">
      <TableHeader><TableRow>
        <TableHead className="w-[12%]">{t("role")}</TableHead><TableHead className="w-[18%]">{t("scope")}</TableHead>
        <TableHead className="w-[35%]">{t("can")}</TableHead><TableHead className="w-[35%]">{t("cannot")}</TableHead>
      </TableRow></TableHeader>
      <TableBody>{roles.map(role => <TableRow key={role}>
        <TableCell className="align-top font-medium">{ROLE_LABEL[role]}</TableCell>
        <TableCell className="align-top md:whitespace-normal">{t(`${role}.scope`)}</TableCell>
        <TableCell className="align-top md:whitespace-normal">{t(`${role}.can`)}</TableCell>
        <TableCell className="align-top md:whitespace-normal text-muted-foreground">{t(`${role}.cannot`)}</TableCell>
      </TableRow>)}</TableBody>
    </Table></CardContent></Card>
  </section>;
}
