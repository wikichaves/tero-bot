import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// "/" routes via role to /dashboard or /mis-tareas — see src/app/page.tsx.
const DEFAULT_NEXT = "/";

/**
 * OAuth / magic-link / password-recovery callback. Supabase redirects users
 * here with a `code` query param after they click the email link; we exchange
 * it for a session cookie and forward them to a same-origin path.
 *
 * SECURITY: `next` is attacker-controlled. We must NOT redirect to an arbitrary
 * URL — that's an open redirect, exploitable for phishing once the user has a
 * valid session cookie. Even prepending the origin is not enough: a value like
 * `next=@evil.com` resolves to `https://yourapp.com@evil.com`, where `evil.com`
 * is the real host (`yourapp.com` becomes userinfo). Validate that `next`
 * resolves to the same origin and contains no userinfo before using it.
 */
function safeNextPath(next: string | null, origin: string): string {
  if (!next) return DEFAULT_NEXT;
  try {
    const parsed = new URL(next, origin);
    if (
      parsed.origin !== origin ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return DEFAULT_NEXT;
    }
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return DEFAULT_NEXT;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), url.origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${url.origin}${next}`);
    }
  }

  return NextResponse.redirect(`${url.origin}/login?error=auth`);
}
