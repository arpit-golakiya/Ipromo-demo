"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Template = {
  id: string | number;
  name: string | null;
  pages: unknown | null;
  created_at: unknown | null;
};

export function LookbookTemplates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/templates", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }

        const json = (await res.json().catch(() => [])) as unknown;
        const list = Array.isArray(json) ? (json as Template[]) : [];

        if (!cancelled) setTemplates(list);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load templates";
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="mt-5 p-4 text-sm text-zinc-200">
          Loading templates…
        </div>
      );
    }

    if (error) {
      return (
        <div className="mt-5 p-4 text-sm text-red-200">
          Failed to load templates.{" "}
          <span className="text-red-100/80">
            ({error.length > 140 ? `${error.slice(0, 140)}…` : error})
          </span>
        </div>
      );
    }

    if (templates.length === 0) {
      return (
        <div className="mt-5 p-4 text-sm text-zinc-200">
          No templates found.
        </div>
      );
    }

    return (
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => {
          const name = String(t.name ?? "").trim() || "Untitled template";

          return (
            <Link
              key={String(t.id)}
              href={`/lookbook/${encodeURIComponent(String(t.id))}`}
              className="group rounded-2xl border border-white/10 bg-zinc-900/60 p-4 transition hover:border-white/20 hover:bg-zinc-900/80"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="truncate text-sm font-semibold text-white group-hover:text-white/95 min-w-0">
                  {name}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    );
  }, [error, loading, templates]);

  return content;
}