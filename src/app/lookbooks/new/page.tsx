"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";

type Template = {
  id: string | number;
  name: string | null;
  created_at: unknown | null;
};

type Brand = {
  id: string;
  name: string;
  imageUrl: string;
  logoVariants: string[];
  createdByEmail: string | null;
};

export default function NewLookbookPage() {
  const router = useRouter();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingData(true);
      setLoadError(null);
      try {
        const [tRes, bRes] = await Promise.all([
          fetch("/api/templates", { cache: "no-store" }),
          fetch("/api/brands", { cache: "no-store" }),
        ]);
        const [tJson, bJson]: [unknown, unknown] = await Promise.all([
          tRes.json().catch(() => []),
          bRes.json().catch(() => []),
        ]);
        if (cancelled) return;
        if (!tRes.ok) throw new Error((tJson as { error?: string } | null)?.error ?? "Failed to load templates");
        if (!bRes.ok) throw new Error((bJson as { error?: string } | null)?.error ?? "Failed to load brands");
        setTemplates(Array.isArray(tJson) ? (tJson as Template[]) : []);
        setBrands(Array.isArray(bJson) ? (bJson as Brand[]) : []);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((t) => String(t.id) === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );
  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === selectedBrandId) ?? null,
    [brands, selectedBrandId],
  );

  const canCreate = !!selectedTemplate && !!selectedBrand && !creating;

  async function handleCreate() {
    if (!selectedTemplate || !selectedBrand) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/lookbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: String(selectedTemplate.id),
          brandId: selectedBrand.id,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to create lookbook");
      }

      router.push("/lookbooks");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[640px] px-3 py-10 sm:px-4 md:px-6">
      {/* Header */}
      <div className="mb-8">
        <button
          type="button"
          onClick={() => router.push("/lookbooks")}
          className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back to Lookbooks
        </button>
        <h1 className="text-xl font-semibold text-slate-900">Create Lookbook</h1>
        <p className="mt-1 text-sm text-slate-600">
          Select a template and a brand. The server will composite the brand logo onto every
          product image using the best-contrast variant and generate a branded PDF.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </div>
      ) : loadingData ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading templates and brands…
        </div>
      ) : (
        <div className="space-y-5">
          {/* Template dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-800" htmlFor="template-select">
              Template
            </label>
            <div className="relative">
              <select
                id="template-select"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                disabled={creating}
                className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-9 text-sm text-slate-900 outline-none focus:border-blue-500 disabled:opacity-60"
              >
                <option value="">— Select a template —</option>
                {templates.map((t) => (
                  <option key={String(t.id)} value={String(t.id)}>
                    {String(t.name ?? "").trim() || "Untitled template"}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
            {templates.length === 0 && (
              <p className="text-xs text-slate-500">No templates found.</p>
            )}
          </div>

          {/* Brand custom dropdown (shows logo thumbnail + name) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-800" htmlFor="brand-select">
              Brand
            </label>
            <div
              className="relative"
              onKeyDown={(e) => { if (e.key === "Escape") setBrandMenuOpen(false); }}
              onBlurCapture={(e) => {
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                setBrandMenuOpen(false);
              }}
            >
              {/* Hidden native select for label association */}
              <select
                id="brand-select"
                value={selectedBrandId}
                onChange={(e) => setSelectedBrandId(e.target.value)}
                className="sr-only"
                aria-hidden
                tabIndex={-1}
              >
                <option value="">— Select a brand —</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>

              <button
                type="button"
                disabled={creating}
                aria-haspopup="listbox"
                aria-expanded={brandMenuOpen}
                className="flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 disabled:opacity-60"
                onClick={() => setBrandMenuOpen((v) => !v)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {selectedBrand?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedBrand.imageUrl}
                      alt=""
                      className="h-6 w-10 flex-shrink-0 rounded border border-slate-100 bg-white object-contain"
                    />
                  ) : (
                    <span className="h-6 w-10 flex-shrink-0 rounded border border-slate-200 bg-slate-50" />
                  )}
                  <span className="truncate">
                    {selectedBrand ? selectedBrand.name : "— Select a brand —"}
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" />
              </button>

              {brandMenuOpen ? (
                <div
                  role="listbox"
                  className="absolute top-full z-20 mt-2 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl"
                >
                  {brands.map((b) => {
                    const active = b.id === selectedBrandId;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={[
                          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                          active ? "bg-slate-50 font-semibold text-slate-900" : "text-slate-800 hover:bg-slate-50",
                        ].join(" ")}
                        onClick={() => { setSelectedBrandId(b.id); setBrandMenuOpen(false); }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={b.imageUrl}
                          alt=""
                          className="h-6 w-10 flex-shrink-0 rounded border border-slate-100 bg-white object-contain"
                          loading="lazy"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.25"; }}
                        />
                        <span className="min-w-0 truncate font-medium">{b.name}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            {brands.length === 0 && (
              <p className="text-xs text-slate-500">
                No brands found.{" "}
                <a href="/brands/new" className="text-blue-600 underline underline-offset-2">
                  Add one first.
                </a>
              </p>
            )}
          </div>

          {/* Selected summary */}
          {selectedTemplate && selectedBrand && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-4">
                {selectedBrand.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedBrand.imageUrl}
                    alt={selectedBrand.name}
                    className="h-12 w-20 flex-shrink-0 rounded-md object-contain"
                  />
                ) : null}
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {String(selectedTemplate.name ?? "").trim() || "Untitled template"}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600">
                    Brand: {selectedBrand.name}
                  </div>
                  {selectedBrand.logoVariants.length > 1 && (
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-xs text-slate-500">Variants:</span>
                      {selectedBrand.logoVariants.slice(0, 4).map((v, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={v}
                          alt={`v${i + 1}`}
                          className="h-6 w-8 rounded border border-slate-200 object-contain"
                          style={{
                            background:
                              i === 1 ? "#1e1e1e"
                                : i === 3 ? "#f0f0f0"
                                  : "repeating-conic-gradient(#e2e8f0 0% 25%,#ffffff 0% 50%) 0 0/10px 10px",
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {createError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {createError}
            </div>
          )}

          {/* Create button */}
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => void handleCreate()}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating lookbook…
              </>
            ) : (
              "Create Lookbook"
            )}
          </button>

          {creating && (
            <p className="text-center text-xs text-slate-500">
              Compositing images and building PDF on the server, this may take a few minutes.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
