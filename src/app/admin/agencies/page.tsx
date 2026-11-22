import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

export default async function AgenciesPage() {
  await requireRole(["admin"]);
  redirect("/admin/users");
}
