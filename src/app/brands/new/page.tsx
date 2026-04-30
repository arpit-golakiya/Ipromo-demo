"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Image as ImageIcon, Loader2, Trash2, UploadCloud } from "lucide-react";
import { BrandVariantColorModal } from "@/components/BrandVariantColorModal";
import { FullPageLoader } from "@/components/FullPageLoader";
import { pickBrandBackgroundHexFromImageUrl } from "@/lib/imageColorsClient";

type CreateOk = { brand: { id: string }; variants: string[] };

function isCreateOk(v: unknown): v is CreateOk {
  if (!v || typeof v !== "object") return false;
  const o = v as { variants?: unknown; brand?: unknown };
  const brand = o.brand as { id?: unknown } | undefined;
  return (
    !!brand &&
    typeof brand.id === "string" &&
    Array.isArray(o.variants) &&
    o.variants.every((x) => typeof x === "string" && x.trim().length > 0)
  );
}

export default function NewBrandPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [variants, setVariants] = useState<string[] | null>(null);
  const [generatedVariants, setGeneratedVariants] = useState<string[] | null>(null);
  const [createdBrandId, setCreatedBrandId] = useState<string | null>(null);
  const [brandBg, setBrandBg] = useState<string>("#0EA5E9");

  const [saving, setSaving] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [colorModal, setColorModal] = useState<{
    open: boolean;
    title: string;
    url: string;
    originalUrl: string;
    bgColor: string;
    idx: number;
  }>({
    open: false,
    title: "",
    url: "",
    originalUrl: "",
    bgColor: "#ffffff",
    idx: 0,
  });

  const canGoNext = useMemo(() => name.trim().length > 0, [name]);
  const canCreate = useMemo(() => name.trim().length > 0 && !!file && !saving, [name, file, saving]);

  useEffect(() => {
    const sourceUrl = variants?.[0];
    if (!sourceUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const hex = await pickBrandBackgroundHexFromImageUrl(sourceUrl);
        if (!cancelled && hex) setBrandBg(hex);
      } catch {
        // ignore; keep fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [variants]);

  function setPickedFile(next: File | null) {
    setFile(next);
    setError(null);
    setVariants(null);
    setGeneratedVariants(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next ? URL.createObjectURL(next) : null;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadDataUrl(dataUrl: string): Promise<string> {
    const blob = await fetch(dataUrl).then((r) => r.blob());
    const form = new FormData();
    form.set("image", new File([blob], "variant.png", { type: "image/png" }));
    const res = await fetch("/api/brands/upload", { method: "POST", body: form });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string } | null)?.error ?? "Upload failed");
    return (json as { publicUrl: string }).publicUrl;
  }

  async function onApprove() {
    if (!createdBrandId) return;
    setSaving(true);
    setError(null);
    try {
      const currentVariants = variants ?? [];

      setLoaderMessage("Saving changes…");
      const variantsChanged = currentVariants.some((u) => u.startsWith("data:"));

      let uploadedVariants: string[] | null = null;
      if (variantsChanged) {
        setLoaderMessage("Uploading variants…");
        uploadedVariants = await Promise.all(
          currentVariants.map((url) => (url.startsWith("data:") ? uploadDataUrl(url) : Promise.resolve(url))),
        );
      }

      const body: Record<string, unknown> = { isApproved: true };
      if (uploadedVariants) body.logoVariants = uploadedVariants;

      const res = await fetch(`/api/brands/${encodeURIComponent(createdBrandId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string } | null)?.error ?? "Failed to approve brand");
      }
      router.replace("/brands");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve brand");
    } finally {
      setSaving(false);
      setLoaderMessage("");
    }
  }

  async function onUploadAndCreate() {
    if (!canCreate || !file) return;
    setLoaderMessage("Generating variants…");
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("image", file, file.name || "brand.png");
      form.set("name", name.trim());

      const createRes = await fetch("/api/brands", { method: "POST", body: form });
      const createJson: unknown = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        const msg =
          (createJson as { error?: unknown } | null)?.error && typeof (createJson as { error?: unknown }).error === "string"
            ? ((createJson as { error: string }).error as string)
            : "Failed to create brand";
        setError(msg);
        return;
      }

      if (!isCreateOk(createJson)) {
        setError("Unexpected response from server");
        return;
      }

      setVariants(createJson.variants);
      setGeneratedVariants(createJson.variants);
      setCreatedBrandId(createJson.brand.id);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create brand");
    } finally {
      setSaving(false);
      setLoaderMessage("");
    }
  }

  return (
    <>
      {saving && <FullPageLoader message={loaderMessage || "Processing…"} />}
      <main className="mx-auto h-full w-full max-w-[900px] overflow-y-auto px-3 py-6 sm:px-4 md:px-6 hide-scrollbar">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Add brand</h1>
            <p className="text-sm text-slate-600">Step {step} of 3</p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/brands")}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Back
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          {step === 1 ? (
            <div className="grid gap-4">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-slate-700">Brand name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ipromo"
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500"
                  autoFocus
                />
              </label>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className={`h-10 rounded-lg px-4 text-sm font-semibold text-white ${canGoNext ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-400"
                    }`}
                  onClick={() => setStep(2)}
                  disabled={!canGoNext}
                >
                  Next
                </button>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="grid gap-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold text-slate-700">Brand name</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900">{name.trim()}</div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div
                  className="bg-slate-50 p-4"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0] ?? null;
                    if (f) setPickedFile(f);
                  }}
                >
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white/40">
                    <div className="flex min-h-[240px] items-center justify-center p-6">
                      {previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previewUrl} alt="" className="max-h-[240px] w-full object-contain" />
                      ) : (
                        <div className="flex flex-col items-center gap-3 text-slate-300">
                          <div className="rounded-2xl bg-slate-100 p-5">
                            <ImageIcon className="h-16 w-16" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0] ?? null;
                      setPickedFile(f);
                    }}
                  />
                </div>

                <div className="flex items-center justify-center gap-3 border-t border-slate-200 bg-white px-4 py-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                    disabled={saving}
                  >
                    <UploadCloud className="h-4 w-4" />
                    Upload File
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickedFile(null)}
                    className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition ${file
                      ? "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                      : "border-slate-200 bg-white text-slate-400 opacity-60"
                      }`}
                    disabled={!file || saving}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove Logo
                  </button>
                </div>
              </div>

              <div className="text-xs text-slate-500">Tip: You can also drag & drop an image into the box.</div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  onClick={() => setStep(1)}
                  disabled={saving}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className={`h-10 rounded-lg px-4 text-sm font-semibold text-white ${canCreate ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-400"
                    }`}
                  onClick={onUploadAndCreate}
                  disabled={!canCreate}
                >
                  {saving ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing…
                    </span>
                  ) : (
                    "Create brand"
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Generated variants</div>
                  <div className="mt-0.5 text-xs text-slate-600">Saved as pending approval.</div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  { title: "Multi Color Logo (Light BG)", idx: 0, bg: "bg-slate-50", resolvedBg: "#F8FAFC" },
                  { title: "Light Color Logo (Dark BG)", idx: 1, bg: "bg-slate-900", resolvedBg: "#0F172A" },
                  { title: "Brand color Background", idx: 2, bg: "bg-[var(--brand-bg)]", resolvedBg: brandBg },
                  { title: "Black Logo", idx: 3, bg: "bg-white", resolvedBg: "#FFFFFF" },
                ].map((card) => {
                  const url = variants?.[card.idx] ?? "";
                  const originalUrl = generatedVariants?.[card.idx] ?? url;
                  return (
                    <div key={card.title} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-xs font-semibold text-slate-800">{card.title}</div>
                      </div>
                      <div
                        className={`aspect-[16/9] w-full ${card.bg}`}
                        style={card.idx === 2 ? ({ ["--brand-bg" as never]: brandBg } as CSSProperties) : undefined}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-full w-full object-contain p-4" />
                      </div>
                      <div className="flex items-center justify-center gap-2 border-t border-slate-200 bg-white px-3 py-2">
                        <button
                          type="button"
                          className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:text-slate-400 disabled:opacity-60"
                          disabled={saving || !url}
                          onClick={() =>
                            setColorModal({
                              open: true,
                              title: card.title,
                              url,
                              originalUrl,
                              bgColor: card.resolvedBg,
                              idx: card.idx,
                            })
                          }
                        >
                          Change Colors
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  onClick={() => setStep(2)}
                  disabled={saving}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-400"
                  disabled={!createdBrandId || saving}
                  onClick={onApprove}
                >
                  Approve
                </button>
              </div>
            </div>
          )}
        </div>

        <BrandVariantColorModal
          open={colorModal.open}
          title={colorModal.title}
          imageUrl={colorModal.url}
          originalImageUrl={colorModal.originalUrl}
          bgColor={colorModal.bgColor}
          onClose={() => setColorModal({ open: false, title: "", url: "", originalUrl: "", bgColor: "#ffffff", idx: 0 })}
          onApply={(appliedUrl) => {
            const idx = colorModal.idx;
            setVariants((prev) => {
              const next = [...(prev ?? [])];
              next[idx] = appliedUrl;
              return next;
            });
            setColorModal({ open: false, title: "", url: "", originalUrl: "", bgColor: "#ffffff", idx: 0 });
          }}
        />
      </main>
    </>
  );
}