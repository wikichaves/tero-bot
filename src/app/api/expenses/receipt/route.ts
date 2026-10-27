import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Authenticated redirect; stored receipt links never expire or expose bot tokens. */
export async function GET(req: NextRequest) {
  await requireRole(["admin", "gestor"]);
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!/^[0-9a-f-]+\/telegram--?\d+-\d+$/.test(path)) return new NextResponse("Invalid receipt", { status: 400 });
  const { data, error } = await createAdminClient().storage.from("expense-receipts").createSignedUrl(path, 60);
  if (error || !data) return new NextResponse("Receipt unavailable", { status: 404 });
  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
