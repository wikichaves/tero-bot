import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// WIK-131: `/` is the public landing now; the page component handles
// redirecting logged-in users to /dashboard, so we just need to keep
// middleware from bouncing anonymous visitors away.
//
// We can't add bare `/` to this list because `pathname.startsWith("/")`
// matches everything — we'd accidentally make the whole app public.
// Instead, `/` gets a dedicated check below in updateSession.
const PUBLIC_PATHS = ["/login", "/auth"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // `/` is a public landing — anyone can see it. Logged-in handling
  // (auto-redirect to /dashboard) happens inside the page component
  // rather than here so SSR rendering of the landing stays simple.
  const isLanding = pathname === "/";
  const isPublic =
    isLanding || PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
