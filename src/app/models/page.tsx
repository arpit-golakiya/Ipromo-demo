"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type LibraryProduct = {
  product_name: string;
  preview_image_url: string | null;
  variants: Array<{
    id: string;
    label: string;
    image_url: string | null;
  }>;
};

export default function AllProductsPage() {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<LibraryProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedByProduct, setExpandedByProduct] = useState<Record<string, boolean>>({});
  const [visibleVariantsByProduct, setVisibleVariantsByProduct] = useState<Record<string, number>>(
    {},
  );

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/library?q=${encodeURIComponent(query)}&limit=500`,
          { cache: "no-store" },
        );
        const data: { products?: LibraryProduct[]; error?: string } = await res.json();
        if (!res.ok || !Array.isArray(data.products)) {
          if (mounted) setError(data.error ?? "Failed to load products");
          if (mounted) setProducts([]);
          return;
        }
        if (mounted) {
          setProducts(data.products);
          // Reset expansion when the dataset changes (e.g. new search query).
          setExpandedByProduct({});
          setVisibleVariantsByProduct({});
        }
      } catch {
        if (mounted) setError("Failed to load products");
        if (mounted) setProducts([]);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [query]);

  const totalVariants = useMemo(
    () => products.reduce((sum, p) => sum + (p.variants?.length ?? 0), 0),
    [products],
  );

  return (
    <main className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-4 md:px-6 md:py-6">
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
          const productKey = p.product_name;
          const isExpanded = !!expandedByProduct[productKey];
          const visibleCount = visibleVariantsByProduct[productKey] ?? 12;
          const visibleVariants = isExpanded ? p.variants.slice(0, visibleCount) : [];

          return (
          <section
            key={p.product_name}
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
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-100">{v.label}</span>
                  <Link
                    href={`/?modelId=${encodeURIComponent(v.id)}`}
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
                        [productKey]: Math.min((prev[productKey] ?? 12) + 12, p.variants.length),
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
    </main>
  );
}

