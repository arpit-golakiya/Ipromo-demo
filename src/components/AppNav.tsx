"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function isMeOk(v: unknown): v is { user: { id: string; username: string; email: string } } {
  if (!v || typeof v !== "object") return false;
  const user = (v as { user?: unknown }).user;
  if (!user || typeof user !== "object") return false;
  const u = user as { id?: unknown; username?: unknown; email?: unknown };
  return typeof u.id === "string" && typeof u.username === "string" && typeof u.email === "string";
}

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<{ id: string; username: string; email: string } | null>(null);

  const shouldHide =
    (pathname?.startsWith("/s/") ?? false) || pathname === "/login" || pathname === "/signup";

  // const itemClass = (active: boolean) =>
  //   `rounded-md px-3 py-1.5 text-sm transition ${active ? "bg-indigo-600 text-white" : "text-zinc-300 hover:bg-white/10 hover:text-white"
  //   }`;

  const routeClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${active ? "bg-indigo-600 text-white" : "text-white hover:bg-white/20 bg-white/10"
    }`;

  useEffect(() => {
    // AppNav is mounted in the root layout even on /login and /signup.
    // When we navigate away after a successful login, we need to re-check /me.
    if (shouldHide) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data: unknown = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && isMeOk(data)) {
          setMe(data.user);
        } else {
          setMe(null);
        }
      } catch {
        if (!cancelled) setMe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shouldHide]);

  const initials = useMemo(() => {
    const name = (me?.username ?? "").trim();
    if (!name) return "U";
    const parts = name.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0]?.toUpperCase() ?? "U";
    const b = parts.length > 1 ? (parts[1]?.[0]?.toUpperCase() ?? "") : "";
    return `${a}${b}`.slice(0, 2);
  }, [me?.username]);

  async function onLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setMe(null);
      router.replace("/login");
      router.refresh();
    }
  }

  if (shouldHide) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/90 backdrop-blur">
      <nav className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between px-3 sm:px-4 md:px-6">
        <div className="flex items-center gap-1">
          <Link
            href="/"
            className="rounded-md px-2 py-1.5 text-sm font-semibold tracking-tight text-white"
          >
            iPromo 3D Merch
          </Link>
          <Link
            href="/models"
            className={routeClass(pathname?.startsWith("/models") ?? false)}
          >
            All Products
          </Link>
          <Link href="/" className={routeClass(pathname === "/")}>
            Design
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/feedback"
            className={routeClass(pathname?.startsWith("/feedback") ?? false)}
          >
            Submit Feedback
          </Link>

          {me ? (
            <div className="group relative">
              <button
                type="button"
                aria-label="User profile"
                className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/10 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                {initials}
              </button>

              <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-64 translate-y-1 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
                <div className="pointer-events-auto rounded-xl border border-white/10 bg-zinc-950/95 p-3 shadow-xl backdrop-blur">
                  <div className="px-1">
                    <div className="text-sm font-semibold text-white">{me.username}</div>
                    <div className="mt-0.5 truncate text-xs text-zinc-300">{me.email}</div>
                  </div>
                  <div className="my-3 h-px bg-white/10" />
                  <button
                    type="button"
                    onClick={onLogout}
                    className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-left text-sm font-medium text-zinc-100 transition hover:bg-white/10"
                  >
                    Logout
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </nav>
    </header>
  );
}