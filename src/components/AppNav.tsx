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
  const [profileOpen, setProfileOpen] = useState(false);

  const shouldHide =
    (pathname?.startsWith("/s/") ?? false) || pathname === "/login" || pathname === "/signup";

  // const itemClass = (active: boolean) =>
  //   `rounded-md px-3 py-1.5 text-sm transition ${active ? "bg-indigo-600 text-white" : "text-zinc-300 hover:bg-white/10 hover:text-white"
  //   }`;

  const routeClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      active
        ? "bg-blue-600 text-white"
        : "text-slate-700 hover:bg-slate-100 bg-transparent"
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

  useEffect(() => {
    setProfileOpen(false);
  }, [pathname]);

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
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur">
      <nav className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between px-3 sm:px-4 md:px-6">
        <div className="flex items-center gap-1">
          <Link
            href="/"
            className="rounded-md px-2 py-1.5 text-sm font-semibold tracking-tight text-slate-900"
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
          <Link
            href="/lookbooks"
            className={routeClass(pathname?.startsWith("/lookbooks") ?? false)}
          >
            Lookbooks
          </Link>
          <Link
            href="/templates"
            className={routeClass(pathname?.startsWith("/templates") ?? false)}
          >
            Templates
          </Link>
          <Link
            href="/brands"
            className={routeClass(pathname?.startsWith("/brands") ?? false)}
          >
            Brands
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
            <div
              className="relative"
              onMouseLeave={() => setProfileOpen(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setProfileOpen(false);
              }}
              onBlurCapture={(e) => {
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                setProfileOpen(false);
              }}
            >
              <button
                type="button"
                aria-label="User profile"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                onMouseEnter={() => setProfileOpen(true)}
                onClick={() => setProfileOpen((v) => !v)}
                className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-800 transition hover:bg-slate-200"
              >
                {initials}
              </button>

              <div
                className={`absolute right-0 top-full z-50 w-64 transition ${profileOpen
                  ? "pointer-events-auto translate-y-0 opacity-100"
                  : "pointer-events-none translate-y-1 opacity-0"
                  }`}
                onMouseEnter={() => setProfileOpen(true)}
              >
                <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                  <div className="px-1">
                    <div className="text-sm font-semibold text-slate-900">{me.username}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-600">{me.email}</div>
                  </div>
                  <div className="my-3 h-px bg-slate-200" />
                  <button
                    type="button"
                    onClick={onLogout}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50"
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