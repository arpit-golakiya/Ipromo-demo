"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MoreVertical, Search, XCircle } from "lucide-react";

type Brand = {
  id: string;
  ownerId: string;
  name: string;
  imageUrl: string;
  logoVariants: string[];
  isApproved: boolean;
  createdByEmail: string | null;
  createdAt: string;
};

function isBrandArray(v: unknown): v is Brand[] {
  if (!Array.isArray(v)) return false;
  return v.every((x) => {
    if (!x || typeof x !== "object") return false;
    const b = x as Partial<Brand>;
    return (
      typeof b.id === "string" &&
      typeof b.ownerId === "string" &&
      typeof b.name === "string" &&
      typeof b.imageUrl === "string" &&
      Array.isArray(b.logoVariants) &&
      b.logoVariants.every((s) => typeof s === "string") &&
      typeof b.isApproved === "boolean" &&
      (b.createdByEmail === null || typeof b.createdByEmail === "string") &&
      typeof b.createdAt === "string"
    );
  });
}

export default function BrandsPage() {
  const router = useRouter();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/brands", { cache: "no-store" });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (data as { error?: unknown } | null)?.error && typeof (data as { error?: unknown }).error === "string"
            ? ((data as { error: string }).error as string)
            : "Failed to load brands";
        setError(msg);
        setBrands([]);
        return;
      }
      if (!isBrandArray(data)) {
        setError("Unexpected response from server");
        setBrands([]);
        return;
      }
      setBrands(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load brands");
      setBrands([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return brands;
    return brands.filter((b) => {
      const name = (b.name ?? "").toLowerCase();
      const email = (b.createdByEmail ?? "").toLowerCase();
      return name.includes(query) || email.includes(query);
    });
  }, [brands, q]);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-3 py-6 sm:px-4 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Brands</h1>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              className="h-9 w-56 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.push("/brands/new")}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          Add Brand
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <section className="mt-6">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading brands…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">No brands yet</div>
            <div className="mt-1 text-sm text-slate-600">
              {brands.length === 0 ? "Click “Add Brand” to create your first one." : "Try a different search."}
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-end gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
              Showing 1 - {filtered.length} of {filtered.length} results
            </div>

            <div className="w-full min-h-[240px] overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-white">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">Primary Logo</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">Brand Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">Created By</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">Date Added</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b, idx) => {
                    const statusLabel = b.isApproved ? "Approved" : "Not Approved";
                    const dateLabel = new Date(b.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    });
                    const isLastRow = idx === filtered.length - 1;
                    const shouldOpenLeft = filtered.length === 1;
                    return (
                      <tr key={b.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <div className="h-10 w-28 rounded-md bg-white">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={b.imageUrl}
                              alt={b.name}
                              className="h-10 w-28 object-contain"
                              loading="lazy"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.opacity = "0.25";
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-semibold text-slate-900">{b.name}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="inline-flex items-center gap-2 text-sm">
                            {b.isApproved ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-amber-500" />
                            )}
                            <span className="text-slate-800">{statusLabel}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-800">{b.createdByEmail ?? "-"}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-800">{dateLabel}</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div
                            className="relative inline-block"
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setOpenMenuId(null);
                            }}
                            onBlurCapture={(e) => {
                              const next = e.relatedTarget as Node | null;
                              if (next && e.currentTarget.contains(next)) return;
                              setOpenMenuId(null);
                            }}
                          >
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-slate-500 hover:border-slate-200 hover:bg-white"
                              aria-label="Actions"
                              aria-haspopup="menu"
                              aria-expanded={openMenuId === b.id}
                              onClick={() => setOpenMenuId((v) => (v === b.id ? null : b.id))}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>

                            {openMenuId === b.id ? (
                              <div
                                className={[
                                  "absolute right-0 z-20 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl",
                                  shouldOpenLeft ? "right-full top-0 mr-2" : isLastRow ? "bottom-full mb-2" : "top-full mt-2",
                                ].join(" ")}
                                role="menu"
                              >
                                <button
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    router.push(`/brands/${encodeURIComponent(b.id)}/edit`);
                                  }}
                                  role="menuitem"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50"
                                  onClick={async () => {
                                    setOpenMenuId(null);
                                    const ok = window.confirm(`Delete brand "${b.name}"? This cannot be undone.`);
                                    if (!ok) return;
                                    try {
                                      const res = await fetch(`/api/brands/${encodeURIComponent(b.id)}`, {
                                        method: "DELETE",
                                      });
                                      if (!res.ok) {
                                        const json: unknown = await res.json().catch(() => ({}));
                                        const msg =
                                          (json as { error?: unknown } | null)?.error &&
                                            typeof (json as { error?: unknown }).error === "string"
                                            ? ((json as { error: string }).error as string)
                                            : "Failed to delete brand";
                                        setError(msg);
                                        return;
                                      }
                                      await load();
                                    } catch (e) {
                                      setError(e instanceof Error ? e.message : "Failed to delete brand");
                                    }
                                  }}
                                  role="menuitem"
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}