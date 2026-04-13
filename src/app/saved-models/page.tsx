"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type SavedItem = {
  product_url: string;
  color_key: string;
  color_label: string | null;
  color_hex: string | null;
  image_url: string;
  task_id: string | null;
  glb_url: string | null;
  created_at?: string;
};

type SavedGroup = {
  productUrl: string;
  previewImageUrl: string;
  items: SavedItem[];
};

function formatProductLabel(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.hostname}${u.pathname.length > 1 ? u.pathname : ""}`;
  } catch {
    return rawUrl;
  }
}

export default function SavedModelsPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState<SavedGroup | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/hyper3d/saved?limit=300");
        const data: { items?: SavedItem[]; error?: string } = await res.json();
        if (!res.ok || !Array.isArray(data.items)) {
          if (mounted) setError(data.error ?? "Failed to load saved models");
          return;
        }
        if (mounted) setItems(data.items.filter((i) => i.task_id && i.image_url));
      } catch {
        if (mounted) setError("Failed to load saved models");
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, SavedGroup>();
    for (const item of items) {
      const existing = map.get(item.product_url);
      if (existing) {
        existing.items.push(item);
      } else {
        map.set(item.product_url, {
          productUrl: item.product_url,
          previewImageUrl: item.image_url,
          items: [item],
        });
      }
    }

    const q = query.trim().toLowerCase();
    const groups = Array.from(map.values())
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => {
          const aLabel = (a.color_label ?? a.color_key).toLowerCase();
          const bLabel = (b.color_label ?? b.color_key).toLowerCase();
          return aLabel.localeCompare(bLabel);
        }),
      }))
      .sort((a, b) => {
        const aTime = new Date(a.items[0]?.created_at ?? 0).getTime();
        const bTime = new Date(b.items[0]?.created_at ?? 0).getTime();
        return bTime - aTime;
      });

    if (!q) return groups;
    return groups.filter((g) => {
      const p = formatProductLabel(g.productUrl).toLowerCase();
      const matchesProduct = p.includes(q) || g.productUrl.toLowerCase().includes(q);
      if (matchesProduct) return true;
      return g.items.some((i) => (i.color_label ?? i.color_key).toLowerCase().includes(q));
    });
  }, [items, query]);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-4 md:px-6 md:py-6">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Saved Models</h1>
          <p className="text-sm text-zinc-400">Browse saved products and load a color model.</p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product or color..."
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none ring-blue-500/40 focus:ring-2 md:w-80"
        />
      </div>

      {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
      {isLoading ? <p className="text-sm text-zinc-400">Loading saved models...</p> : null}
      {!isLoading && grouped.length === 0 ? (
        <p className="text-sm text-zinc-500">No saved models found.</p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {grouped.map((group) => {
          return (
            <section
              key={group.productUrl}
              className="rounded-xl border border-white/10 bg-zinc-900/70 p-3"
            >
              <div className="flex w-full items-center gap-3 text-left">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={group.previewImageUrl}
                  alt={formatProductLabel(group.productUrl)}
                  className="h-14 w-14 shrink-0 rounded object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-100">
                    {formatProductLabel(group.productUrl)}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {group.items.length} color{group.items.length > 1 ? "s" : ""} saved
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveGroup(group)}
                  className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-500"
                >
                  Show
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {activeGroup ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setActiveGroup(null)}
        >
          <div
            className="w-full max-w-xl rounded-xl border border-white/10 bg-zinc-900 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-white">
                  {formatProductLabel(activeGroup.productUrl)}
                </h2>
                <p className="text-xs text-zinc-400">
                  {activeGroup.items.length} color{activeGroup.items.length > 1 ? "s" : ""} available
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveGroup(null)}
                className="rounded border border-white/15 px-2 py-1 text-xs text-zinc-300 hover:bg-white/10"
              >
                Close
              </button>
            </div>
            <div className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
              {activeGroup.items.map((item) => {
                const href = `/?taskId=${encodeURIComponent(item.task_id as string)}`;
                return (
                  <div
                    key={`${item.task_id}-${item.color_key}-${item.image_url}`}
                    className="flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-2 py-1.5"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.image_url}
                      alt={item.color_label ?? item.color_key}
                      className="h-8 w-8 shrink-0 rounded object-cover"
                    />
                    <span className="truncate text-xs text-zinc-100">
                      {item.color_label ?? item.color_key}
                    </span>
                    {item.color_hex ? (
                      <span
                        className="ml-auto h-3.5 w-3.5 shrink-0 rounded-full border border-white/30"
                        style={{ backgroundColor: item.color_hex }}
                        title={item.color_hex}
                      />
                    ) : null}
                    <Link
                      href={href}
                      className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-500"
                    >
                      Load
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

