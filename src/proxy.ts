import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Skip the auth proxy for:
  //  - Next internals and static assets
  //  - /api/* — external integrations (Kapso webhook, cron, future webhooks).
  //    Each route handler is responsible for its own auth (HMAC sig, Bearer
  //    token, etc.). Without this exclusion, unauth POSTs get redirected to
  //    /login (307) and the webhook never executes.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
