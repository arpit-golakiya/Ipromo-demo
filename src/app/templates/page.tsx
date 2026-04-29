"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Search } from "lucide-react";

type Template = {
  id: string | number;
  name: string | null;
  pages: unknown | null;
  created_at: unknown | null;
};

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
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
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load templates");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter((t) =>
      String(t.name ?? "").toLowerCase().includes(query)
    );
  }, [templates, q]);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-3 py-6 sm:px-4 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Templates</h1>
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
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <section className="mt-6">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Loading templates…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">No templates yet</div>
            <div className="mt-1 text-sm text-slate-600">
              {templates.length === 0 ? "No templates have been added." : "Try a different search."}
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-end gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
              Showing 1 - {filtered.length} of {filtered.length} results
            </div>

            <div className="w-full min-h-[240px] overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-white">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">Date Added</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t, idx) => {
                    const id = String(t.id);
                    const name = String(t.name ?? "").trim() || "Untitled template";
                    const dateLabel = t.created_at
                      ? new Date(String(t.created_at)).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })
                      : "—";
                    const isLastRow = idx === filtered.length - 1;
                    const shouldOpenLeft = filtered.length === 1;

                    return (
                      <tr
                        key={id}
                        className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60 cursor-pointer"
                        onClick={() => router.push(`/templates/${encodeURIComponent(id)}`)}
                      >
                        <td className="px-4 py-3">
                          <div className="text-sm font-semibold text-slate-900">{name}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-800">{dateLabel}</div>
                        </td>
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
                              aria-expanded={openMenuId === id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId((v) => (v === id ? null : id));
                              }}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>

                            {openMenuId === id ? (
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuId(null);
                                    router.push(`/templates/${encodeURIComponent(id)}`);
                                  }}
                                  role="menuitem"
                                >
                                  View
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
