import { NextResponse, type NextRequest } from "next/server";

function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/signup") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  // Public read-only APIs (used by shared links / unauthenticated views)
  if (pathname.startsWith("/api/share")) return true;
  if (pathname.startsWith("/api/library/model")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname.startsWith("/s/")) return true; // shared read-only link
  if (pathname.startsWith("/enhanced-logos/")) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const session = req.cookies.get("ipromo_session")?.value ?? "";
  if (session) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};