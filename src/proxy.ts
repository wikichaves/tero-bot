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
  //  - manifest.webmanifest + manifest.json (PWA install). Chrome/Safari
  //    fetch este archivo SIN cookies de sesión cuando ofrecen "Add to
  //    Home Screen" — si lo redirigimos a /login, el browser no encuentra
  //    los iconos y el shortcut sale con icon default gris (WIK-95-2).
  matcher: [
    // WIK-131: added `avif` to the static-asset extension list. Without
    // it, `<picture>` sources with `image/avif` get a 307 → /login from
    // the auth proxy and the browser silently falls through to the WebP
    // fallback, defeating the optimization.
    "/((?!api|_next/static|_next/image|favicon.ico|manifest\\.webmanifest|manifest\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)",
  ],
};
