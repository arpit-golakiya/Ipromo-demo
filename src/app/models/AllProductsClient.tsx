"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

export type LibraryProduct = {
  product_key?: string | null;
  product_name: string;
  preview_image_url: string | null;
  variants: Array<{
    id: string;
    label: string;
    image_url: string | null;
  }>;
};

type LibraryResponse = {
  products?: LibraryProduct[];
  nextCursor?: string | null;
  error?: string;
};

export default function AllProductsClient(props: {
  initialProducts: LibraryProduct[];
  initialNextCursor: string | null;
}) {
  const { initialProducts, initialNextCursor } = props;
  const scrollRootRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<LibraryProduct[]>(initialProducts);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedByProduct, setExpandedByProduct] = useState<Record<string, boolean>>({});
  const [visibleVariantsByProduct, setVisibleVariantsByProduct] = useState<Record<string, number>>(
    {},
  );
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const activeQueryRef = useRef<string>("");

  const fetchPage = async (opts: { q: string; cursor: string | null; append: boolean }) => {
    const url = new URL("/api/library", window.location.origin);
    url.searchParams.set("q", opts.q);
    url.searchParams.set("pageSize", "12");
    if (opts.cursor) url.searchParams.set("cursor", opts.cursor);

    const res = await fetch(url.toString());
    const data: LibraryResponse = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data.products)) {
      throw new Error(data?.error ?? "Failed to load products");
    }

    // Ignore responses for stale queries (race protection).
    if (activeQueryRef.current !== opts.q) return;

    setNextCursor(typeof data.nextCursor === "string" ? data.nextCursor : null);
    setProducts((prev) => {
      const incoming = data.products ?? [];
      if (!opts.append) return incoming;
      const seen = new Set(prev.map((p) => String(p.product_key ?? p.product_name)));
      const merged = [...prev];
      for (const p of incoming) {
        const k = String(p.product_key ?? p.product_name);
        if (!seen.has(k)) {
          merged.push(p);
          seen.add(k);
        }
      }
      return merged;
    });
  };

  useEffect(() => {
    let mounted = true;
    const q = query.trim();
    activeQueryRef.current = q;

    // If we server-rendered the initial (empty) query, don't refetch it; just restore it.
    if (q === "" && initialProducts.length > 0) {
      setError(null);
      setIsLoading(false);
      setIsLoadingMore(false);
      setProducts(initialProducts);
      setNextCursor(initialNextCursor);
      return;
    }

    const debounce = setTimeout(() => {
      if (!mounted) return;
      setIsLoading(true);
      setIsLoadingMore(false);
      setError(null);
      setProducts([]);
      setNextCursor(null);
      setExpandedByProduct({});
      setVisibleVariantsByProduct({});

      fetchPage({ q, cursor: null, append: false })
        .catch((e) => {
          if (mounted) setError(e instanceof Error ? e.message : "Failed to load products");
        })
        .finally(() => {
          if (mounted) setIsLoading(false);
        });
    }, 350);

    return () => {
      mounted = false;
      clearTimeout(debounce);
    };
  }, [query, initialNextCursor, initialProducts]);

  const totalVariants = useMemo(
    () => products.reduce((sum, p) => sum + (p.variants?.length ?? 0), 0),
    [products],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (isLoading || isLoadingMore) return;
    if (!nextCursor) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (!hit) return;
        if (isLoading || isLoadingMore) return;
        if (!nextCursor) return;

        setIsLoadingMore(true);
        fetchPage({ q: activeQueryRef.current, cursor: nextCursor, append: true })
          .catch((e) => setError(e instanceof Error ? e.message : "Failed to load products"))
          .finally(() => setIsLoadingMore(false));
      },
      // Important: the page scrolls inside the <main> container (overflow-y-auto),
      // so the observer root must be that scroll container (not the viewport).
      { root: scrollRootRef.current, rootMargin: "600px 0px", threshold: 0.01 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isLoading, isLoadingMore, nextCursor]);

  return (
    <main
      ref={(node) => {
        scrollRootRef.current = node;
      }}
      className="h-full overflow-y-auto hide-scrollbar mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-4 md:px-6 md:py-6"
    >
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">All Products</h1>
          <p className="text-sm text-zinc-400">
            {products.length} product{products.length === 1 ? "" : "s"} · {totalVariants} color
            {totalVariants === 1 ? "" : "s"}
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product name..."
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none ring-blue-500/40 focus:ring-2 md:w-96"
        />
      </div>

      {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
      {isLoading ? <p className="text-sm text-zinc-400">Loading products…</p> : null}
      {!isLoading && products.length === 0 ? (
        <p className="text-sm text-zinc-500">No products found.</p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => {
          const productKey = String(p.product_key ?? p.product_name);
          const isExpanded = !!expandedByProduct[productKey];
          const visibleCount = visibleVariantsByProduct[productKey] ?? 12;
          const visibleVariants = isExpanded ? p.variants.slice(0, visibleCount) : [];

          return (
            <section
              key={productKey}
              className="rounded-xl border border-white/10 bg-zinc-900/70 p-3"
            >
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-black/30">
                  {p.preview_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.preview_image_url}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-100">{p.product_name}</p>
                  <p className="text-xs text-zinc-400">
                    {p.variants.length} color{p.variants.length === 1 ? "" : "s"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setExpandedByProduct((prev) => {
                      const next = !prev[productKey];
                      return { ...prev, [productKey]: next };
                    });
                    setVisibleVariantsByProduct((prev) =>
                      prev[productKey] ? prev : { ...prev, [productKey]: 12 },
                    );
                  }}
                  className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] font-medium text-zinc-100 hover:bg-white/10"
                >
                  {isExpanded ? "Hide colors" : "View colors"}
                </button>
              </div>

              {isExpanded ? (
                <div className="mt-3 max-h-52 space-y-1.5 overflow-y-auto pr-1">
                  {visibleVariants.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-2 py-1.5"
                    >
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-black/30">
                        {v.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={v.image_url}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : null}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-100">
                        {v.label}
                      </span>
                      <Link
                        href={`/?${new URLSearchParams({
                          modelId: v.id,
                          productName: `${p.product_name} — ${v.label}`,
                          productKey: String(p.product_key ?? p.product_name),
                        }).toString()}`}
                        className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-500"
                      >
                        Load
                      </Link>
                    </div>
                  ))}

                  {p.variants.length > visibleCount ? (
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleVariantsByProduct((prev) => ({
                          ...prev,
                          [productKey]: Math.min(
                            (prev[productKey] ?? 12) + 12,
                            p.variants.length,
                          ),
                        }))
                      }
                      className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-xs font-medium text-zinc-200 hover:bg-white/10"
                    >
                      Show more colors ({p.variants.length - visibleCount} remaining)
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div ref={sentinelRef} className="h-8" />
      {isLoadingMore ? <p className="mt-3 text-sm text-zinc-400">Loading more products…</p> : null}
    </main>
  );
}