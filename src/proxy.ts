import { NextResponse, type NextRequest } from "next/server";

/**
 * Security headers for every HTML response. API routes set their own CORS headers.
 * The CSP allows inline styles because shiki emits per-token `style` attributes.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const response = NextResponse.next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
  response.headers.set("Content-Security-Policy", csp);
  // Paste pages must never be indexed; the home/docs pages may be.
  const path = request.nextUrl.pathname;
  if (path !== "/" && !path.startsWith("/docs") && !path.startsWith("/api")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|manifest.webmanifest).*)"],
};
