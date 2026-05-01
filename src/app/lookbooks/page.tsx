"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, MoreVertical, Search, SquareArrowOutUpRight } from "lucide-react";
import { lookbookPdfFilename } from "@/lib/lookbookPdfFilename";
type Lookbook = {
  id: string;
  ownerId: string;
  title: string;
  brandId: string;
  brandName: string;
  templateId: string;
  pdfUrl: string;
  previewUrl: string | null;
  createdByEmail: string | null;
  createdAt: string;
};

function isLookbookArray(v: unknown): v is Lookbook[] {
  if (!Array.isArray(v)) return false;
  return v.every((x) => {
    if (!x || typeof x !== "object") return false;
    const lb = x as Partial<Lookbook>;
    return (
      typeof lb.id === "string" &&
      typeof lb.title === "string" &&
      typeof lb.brandName === "string" &&
      typeof lb.pdfUrl === "string"
    );
  });
}

export default function LookbooksPage() {
  const router = useRouter();
  const [lookbooks, setLookbooks] = useState<Lookbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function downloadLookbookPdf(lb: Lookbook) {
    if (downloadingId) return;
    setDownloadingId(lb.id);
    try {
      const res = await fetch(`/api/lookbooks/${lb.id}/download`, { credentials: "include" });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => ({}));
        const msg =
          typeof (data as { error?: unknown } | null)?.error === "string"
            ? (data as { error: string }).error
            : "Download failed";
        throw new Error(msg);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = lookbookPdfFilename(lb.title);
      a.click();
      URL.revokeObjectURL(href);
      setOpenMenuId(null);
    } catch (e) {
      console.error(e);
    } finally {
      setDownloadingId(null);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lookbooks", { cache: "no-store" });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (data as { error?: unknown } | null)?.error &&
            typeof (data as { error?: unknown }).error === "string"
            ? ((data as { error: string }).error as string)
            : "Failed to load lookbooks";
        setError(msg);
        setLookbooks([]);
        return;
      }
      if (!isLookbookArray(data)) {
        setError("Unexpected response from server");
        setLookbooks([]);
        return;
      }
      setLookbooks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load lookbooks");
      setLookbooks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return lookbooks;
    return lookbooks.filter(
      (lb) =>
        lb.title.toLowerCase().includes(query) ||
        lb.brandName.toLowerCase().includes(query) ||
        (lb.createdByEmail ?? "").toLowerCase().includes(query),
    );
  }, [lookbooks, q]);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-3 py-6 sm:px-4 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Lookbooks</h1>
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
          onClick={() => router.push("/lookbooks/new")}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          Create Lookbook
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <section className="mt-6">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Loading lookbooks…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">No lookbooks yet</div>
            <div className="mt-1 text-sm text-slate-600">
              {lookbooks.length === 0
                ? 'Click "Create Lookbook" to generate your first one.'
                : "Try a different search."}
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-end gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
              Showing 1 - {filtered.length} of {filtered.length} results
            </div>

            <div className="w-full min-h-[240px] max-h-[70vh] overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-slate-200 bg-white">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">
                      Preview
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">
                      Title
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">
                      Brand
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">
                      Date Added
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">
                      Created By
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((lb, idx) => {
                    const dateLabel = new Date(lb.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    });
                    const isLastRow = idx === filtered.length - 1;
                    return (
                      <tr
                        key={lb.id}
                        className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60"
                      >
                        {/* Preview */}
                        <td className="px-4 py-3">
                          <div className="h-18 w-16 overflow-hidden rounded-md border border-slate-100 bg-slate-50">
                            {lb.previewUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={lb.previewUrl}
                                alt={lb.title}
                                className="h-full w-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.opacity = "0.25";
                                }}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
                                No preview
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Title */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-slate-900">{lb.title}</span>
                            <a
                              href={lb.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title=""
                              className="group relative inline-flex items-center rounded p-0.5 text-slate-400 transition hover:text-blue-600"
                            >
                              <SquareArrowOutUpRight className="h-3.5 w-3.5 text-slate-900" />
                              <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-200 px-2 py-0.5 text-[11px] text-zinc-900 opacity-0 transition-opacity group-hover:opacity-100">
                                View PDF
                              </span>
                            </a>
                          </div>
                        </td>

                        {/* Brand */}
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-800">{lb.brandName}</div>
                        </td>

                        {/* Date */}
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-800">{dateLabel}</div>
                        </td>

                        {/* Created by */}
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-800">{lb.createdByEmail ?? "—"}</div>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 text-right">
                          <div
                            className="relative inline-block"
                            onKeyDown={(e) => { if (e.key === "Escape") setOpenMenuId(null); }}
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
                              aria-expanded={openMenuId === lb.id}
                              onClick={() => setOpenMenuId((v) => (v === lb.id ? null : lb.id))}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>

                            {openMenuId === lb.id ? (
                              <div
                                className={[
                                  "absolute right-0 z-20 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl",
                                  isLastRow ? "bottom-full mb-2" : "top-full mt-2",
                                ].join(" ")}
                                role="menu"
                              >
                                <button
                                  type="button"
                                  disabled={downloadingId !== null}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  role="menuitem"
                                  onClick={() => void downloadLookbookPdf(lb)}
                                >
                                  {downloadingId === lb.id ? (
                                    <>
                                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-600" />
                                      Downloading…
                                    </>
                                  ) : (
                                    <>
                                      <Download className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                                      Download PDF
                                    </>
                                  )}
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
