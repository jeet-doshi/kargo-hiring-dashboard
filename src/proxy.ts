import { NextResponse, type NextRequest } from "next/server";

/**
 * Password gate for the whole dashboard (pages and API routes).
 *
 * HTTP Basic auth against DASHBOARD_USER / DASHBOARD_PASSWORD. Fails closed: if
 * the password is not configured in production, nothing is served. In local
 * development with no password set, the gate is skipped for convenience.
 */
function safeEqual(a: string, b: string): boolean {
  // Constant-time comparison so response timing doesn't leak the password.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Kargo Hiring Dashboard", charset="UTF-8"' },
  });
}

export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  const user = process.env.DASHBOARD_USER || "founder";

  if (!password) {
    if (process.env.NODE_ENV === "development") return NextResponse.next();
    return new NextResponse("Dashboard access is not configured (DASHBOARD_PASSWORD is not set).", { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return unauthorized();
  let decoded = "";
  try {
    decoded = atob(header.slice(6));
  } catch {
    return unauthorized();
  }
  const sep = decoded.indexOf(":");
  const givenUser = sep >= 0 ? decoded.slice(0, sep) : "";
  const givenPassword = sep >= 0 ? decoded.slice(sep + 1) : "";
  // Evaluate both comparisons (no short-circuit) to keep timing uniform.
  const userOk = safeEqual(givenUser, user);
  const passwordOk = safeEqual(givenPassword, password);
  return userOk && passwordOk ? NextResponse.next() : unauthorized();
}

export const config = {
  // Everything except Next.js build assets (which contain no data).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
