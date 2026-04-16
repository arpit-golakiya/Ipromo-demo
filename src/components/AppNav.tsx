"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AppNav() {
  const pathname = usePathname();

  // Keep shared links clean and read-only.
  if (pathname?.startsWith("/s/")) return null;

  const itemClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm transition ${
      active ? "bg-indigo-600 text-white" : "text-zinc-300 hover:bg-white/10 hover:text-white"
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/90 backdrop-blur">
      <nav className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between px-3 sm:px-4 md:px-6">
        <div className="flex items-center gap-1">
          <Link href="/" className="rounded-md px-2 py-1.5 text-sm font-semibold tracking-tight text-white">
            3D Branded Merch
          </Link>
          <Link href="/models" className={itemClass(pathname?.startsWith("/models") ?? false)}>
            All Products
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <Link href="/" className={itemClass(pathname === "/")}>
            Design
          </Link>
          <Link
            href="/feedback"
            className={itemClass(pathname?.startsWith("/feedback") ?? false)}
          >
            Submit Feedback
          </Link>
        </div>
      </nav>
    </header>
  );
}

