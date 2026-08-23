import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedEmail } from "@/lib/authz";
import { resolveLandingPage } from "@/lib/default-dashboard";

const LEAD_WEBHOOK_PATH = "/api/customer-service/leads/webhook";

function copyCookies(source: NextResponse, target: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie.name, cookie.value, cookie);
  });
  return target;
}

function apiAuthError(
  source: NextResponse | null,
  status: 401 | 403 | 503,
  error: string,
): NextResponse {
  const response = NextResponse.json(
    { error },
    {
      status,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
  return source ? copyCookies(source, response) : response;
}

function loginRedirect(request: NextRequest, error?: string): NextResponse {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  if (error) loginUrl.searchParams.set("error", error);
  return NextResponse.redirect(loginUrl);
}

// IMPORTANT: Do not add any code between createServerClient and getUser().
// A token refresh may happen here — cookies must be written back before
// any other logic runs.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Shopify app proxies append a slash when the storefront calls the proxy
  // root. Rewriting instead of redirecting preserves the signed POST body and
  // keeps the browser on the same-origin /apps/rf-leads URL.
  if (pathname === `${LEAD_WEBHOOK_PATH}/`) {
    const webhookUrl = new URL(request.url);
    webhookUrl.pathname = LEAD_WEBHOOK_PATH;
    return NextResponse.rewrite(webhookUrl);
  }

  // skipTrailingSlashRedirect lets the webhook exception above reach Proxy.
  // Preserve Next.js's default canonical URL behavior everywhere else.
  if (pathname.length > 1 && pathname.endsWith("/")) {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.pathname = pathname.slice(0, -1);
    return NextResponse.redirect(canonicalUrl, 308);
  }

  const isApi = pathname.startsWith("/api/");
  const isPublic =
    pathname === "/login" ||
    pathname === "/privacy" ||
    pathname === "/support" ||
    // Password recovery — reached from the reset email while signed out.
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    // Safari fetches the PWA manifest without auth cookies when the user
    // adds the site to their home screen; it holds no sensitive data.
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/survey/") ||
    pathname.startsWith("/api/survey/") ||
    // The office TV board. Session-less by design so no shared machine stays
    // signed in; the route itself checks the token and 404s without a valid
    // one, so "public" here means "authenticated by token instead".
    pathname.startsWith("/wall/") ||
    pathname === LEAD_WEBHOOK_PATH ||
    pathname === "/api/customer-service/leads/meta-webhook" ||
    pathname === "/api/webhooks/whatsapp" ||
    pathname === "/api/internal/whatsapp/employee-context";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    if (isPublic) return NextResponse.next({ request });
    if (isApi) return apiAuthError(null, 503, "Authentication is unavailable");
    return loginRedirect(request);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    if (isApi) return apiAuthError(supabaseResponse, 401, "Unauthorized");
    return copyCookies(supabaseResponse, loginRedirect(request));
  }

  // Google OAuth lets any account complete sign-in, so a valid Supabase
  // session alone doesn't mean the user is allowed in. Reject anyone whose
  // email isn't owner / allowed-domain / employee / admin_users, sign them
  // out, and surface a clear "not authorized" message on /login. Without
  // this, unauthorized users get stuck in a redirect loop between / and
  // /login (proxy bounces them off /login because they have a session,
  // page bounces them off / because admin-auth rejects them).
  if (user && !isPublic) {
    const allowed = await isAuthorizedEmail(user.email);
    if (!allowed) {
      await supabase.auth.signOut();
      if (isApi) {
        return apiAuthError(supabaseResponse, 403, "Forbidden");
      }
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("error", "not_authorized");
      const redirectResponse = NextResponse.redirect(loginUrl);
      // signOut() wrote cookie deletions onto supabaseResponse via the
      // setAll adapter — copy them onto the redirect so the session is
      // actually cleared in the browser.
      return copyCookies(supabaseResponse, redirectResponse);
    }
  }

  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    // Explicit preference wins; "auto" resolves to the role's dashboard. Only
    // this login-bounce branch pays the employees lookup — never a normal
    // request — and resolveLandingPage falls back to "/" instead of throwing.
    homeUrl.pathname = await resolveLandingPage(user);
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
