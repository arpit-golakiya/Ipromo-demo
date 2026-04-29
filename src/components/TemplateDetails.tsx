"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { downloadTemplatePdf } from "@/lib/pdfExport";
import { compositeToDataUrl } from "@/lib/imageComposite.client";

type Template = {
  id: string | number;
  name: string | null;
  pages: unknown | null;
  created_at: unknown | null;
};

const CAPTURE_ID = "template-preview";

type LogoPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};

type ImageRecordLike = {
  id: string;
  url: string;
  title?: string | null;
  logo_position: LogoPosition;
};

type PageRecordLike = {
  id: string;
  productname: string;
  images: ImageRecordLike[];
};

type Tile = { xPct: number; yPct: number; wPct: number; hPct: number };

function tilesStyleB(count: number): Tile[] {
  if (count <= 1) return [{ xPct: 0, yPct: 0, wPct: 100, hPct: 100 }];

  const GAP = 4;
  const RIGHT_COL_Y_OFFSET = 3.5;
  const LEFT_COL_BOTTOM_OFFSET = RIGHT_COL_Y_OFFSET;

  if (count === 2) {
    const w = (100 - GAP) / 2;
    return [
      // Left tile reserves a bottom gap equal to the right column's top offset.
      { xPct: 0, yPct: 0, wPct: w, hPct: 100 - LEFT_COL_BOTTOM_OFFSET },
      { xPct: w + GAP, yPct: RIGHT_COL_Y_OFFSET, wPct: w, hPct: 100 - RIGHT_COL_Y_OFFSET },
    ];
  }

  const w = (100 - GAP) / 2;
  const h = (100 - GAP) / 2;
  // Left column: keep internal GAP, but reserve bottom space for the whole column.
  const leftH = (100 - GAP - LEFT_COL_BOTTOM_OFFSET) / 2;
  return [
    { xPct: 0, yPct: 0, wPct: w, hPct: leftH },
    { xPct: w + GAP, yPct: RIGHT_COL_Y_OFFSET, wPct: w, hPct: h - RIGHT_COL_Y_OFFSET },
    { xPct: 0, yPct: leftH + GAP, wPct: w, hPct: leftH },
    { xPct: w + GAP, yPct: h + GAP, wPct: w, hPct: h },
  ].slice(0, count);
}

function safeImageCaption(img: { title?: string | null; url: string }) {
  if (img.title?.trim()) return img.title.trim();
  try {
    const u = new URL(img.url);
    const base = decodeURIComponent(u.pathname.split("/").pop() || "image");
    return base.replace(/\.[a-zA-Z0-9]+$/, "");
  } catch {
    const base = (img.url.split("?")[0] ?? "").split("#")[0].split("/").pop() || "image";
    return base.replace(/\.[a-zA-Z0-9]+$/, "");
  }
}

function normalizeLogoPosition(pos: unknown): LogoPosition {
  const fallback: LogoPosition = { x: 0.66, y: 0.08, width: 0.26, height: 0.18, rotation: 0 };
  if (!pos || typeof pos !== "object") return fallback;
  const p = pos as Partial<LogoPosition>;
  const x = typeof p.x === "number" ? p.x : fallback.x;
  const y = typeof p.y === "number" ? p.y : fallback.y;
  const width = typeof p.width === "number" ? p.width : fallback.width;
  const height = typeof p.height === "number" ? p.height : fallback.height;
  const rotation = typeof p.rotation === "number" ? p.rotation : 0;
  return { x, y, width, height, rotation };
}

function asRecord(x: unknown): Record<string, unknown> | null {
  if (!x || typeof x !== "object") return null;
  return x as Record<string, unknown>;
}

function posKey(pos: LogoPosition) {
  return `${pos.x}:${pos.y}:${pos.width}:${pos.height}:${pos.rotation ?? 0}`;
}

function parsePages(pages: unknown): PageRecordLike[] {
  const pagesRec = asRecord(pages);
  const embeddedPages = pagesRec ? pagesRec["pages"] : null;
  const arr = Array.isArray(pages) ? pages : Array.isArray(embeddedPages) ? embeddedPages : null;
  if (!arr) return [];

  return arr
    .map((rawPage, pageIdx) => {
      const p = asRecord(rawPage) ?? {};
      const productname = String(
        p["productname"] ?? p["productName"] ?? p["title"] ?? `Page ${pageIdx + 1}`,
      ).trim();

      const imagesA = p["images"];
      const imagesB = p["product_images"];
      const imagesC = p["items"];
      const imagesRaw = Array.isArray(imagesA) ? imagesA : Array.isArray(imagesB) ? imagesB : Array.isArray(imagesC) ? imagesC : [];

      const images = imagesRaw
        .map((rawImg, imgIdx) => {
          const i = asRecord(rawImg) ?? {};
          const url = String(i["url"] ?? i["image_url"] ?? i["src"] ?? "").trim();
          if (!url) return null;
          const title =
            typeof i["title"] === "string"
              ? (i["title"] as string)
              : typeof i["caption"] === "string"
                ? (i["caption"] as string)
                : null;
          const logo_position = normalizeLogoPosition(i["logo_position"] ?? i["logoPosition"] ?? i["logo_pos"]);
          const id = String(i["id"] ?? `${pageIdx}-${imgIdx}-${url}`);
          return { id, url, title, logo_position } satisfies ImageRecordLike;
        })
        .filter(Boolean) as ImageRecordLike[];

      return {
        id: String(p["id"] ?? p["page_id"] ?? `page-${pageIdx}`),
        productname,
        images,
      } satisfies PageRecordLike;
    })
    .filter((p) => p.images.length > 0);
}

function LookbookTile(props: { img: ImageRecordLike; logoDataUrl: string | null; tile: Tile }) {
  const { img, logoDataUrl, tile } = props;
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const logoPosKey = useMemo(() => posKey(img.logo_position), [img.logo_position]);

  useEffect(() => {
    if (!logoDataUrl) {
      setSrc(null);
      setFailed(false);
      return;
    }

    let alive = true;
    setSrc(null);
    setFailed(false);

    compositeToDataUrl(img.url, logoDataUrl, img.logo_position, 1024)
      .then((dataUrl) => {
        if (!alive) return;
        setSrc(dataUrl);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
      });

    return () => {
      alive = false;
    };
  }, [img.id, img.url, logoDataUrl, img.logo_position, logoPosKey]);

  const caption = safeImageCaption(img);

  return (
    <div
      className="absolute overflow-hidden bg-zinc-950 ring-1 ring-white/10 shadow-sm"
      style={{
        left: `${tile.xPct}%`,
        top: `${tile.yPct}%`,
        width: `${tile.wPct}%`,
        height: `${tile.hPct}%`,
      }}
    >
      {logoDataUrl ? (
        src ? (
          <div className="flex h-full w-full items-center justify-center bg-zinc-950">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={caption} className="block h-full w-full object-cover" />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {failed ? (
              <span className="text-xs font-medium text-gray-400">Image unavailable</span>
            ) : (
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />
            )}
          </div>
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-zinc-950">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.url}
            alt={caption}
            className="block h-full w-full object-cover"
            crossOrigin="anonymous"
          />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0">
        <div className="h-9 bg-black/10" />
        <div className="absolute inset-x-0 bottom-0 px-3 py-2 text-[11px] font-semibold text-white truncate drop-shadow-[0_1px_1px_rgba(0,0,0,0.65)]">
          {caption}
        </div>
      </div>
    </div>
  );
}

function LookbookPreview(props: { pages: PageRecordLike[]; logoDataUrl: string | null }) {
  const { pages, logoDataUrl } = props;
  const totalPages = pages.length;
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    setPageIndex(0);
  }, [totalPages]);

  const page = pages[pageIndex] ?? null;
  const imagesToRender = useMemo(() => (page ? page.images.slice(0, 4) : []), [page]);
  const tiles = useMemo(() => tilesStyleB(imagesToRender.length), [imagesToRender.length]);
  if (!page) return null;

  return (
    <section className="space-y-3 overflow-y-auto hide-scrollbar h-full">
      <div className="flex w-full justify-center">
        <div className="w-full max-w-[780px]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
              disabled={pageIndex === 0}
              className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Prev
            </button>

            <div className="text-xs font-semibold text-zinc-600">
              Page {pageIndex + 1} / {totalPages}
            </div>

            <button
              type="button"
              onClick={() => setPageIndex((i) => Math.min(totalPages - 1, i + 1))}
              disabled={pageIndex >= totalPages - 1}
              className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Next
            </button>
          </div>

          <div className="overflow-hidden bg-white">
            <div className="aspect-[210/297] p-6 sm:p-7">
              <div className="flex h-full flex-col">
                <div className="shrink-0">
                  <div className="text-center text-[13px] sm:text-[14px] font-bold text-gray-900">
                    {page.productname}
                  </div>
                  <div className="mt-3 h-px bg-gray-200" />
                </div>

                <div className="relative mt-5 grow">
                  <div className="absolute inset-0">
                    {imagesToRender.map((img, idx) => (
                      <LookbookTile key={img.id} img={img} logoDataUrl={logoDataUrl} tile={tiles[idx]!} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {page.images.length > 4 ? (
            <div className="mt-2 text-xs text-zinc-400">Showing first 4 images (same as PDF).</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function TemplateDetails({
  id,
  showSidebar = true,
  backHref = "/lookbooks",
  backLabel = "Back to Lookbooks",
}: {
  id: string;
  showSidebar?: boolean;
  backHref?: string;
  backLabel?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<Template | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/templates/${encodeURIComponent(id)}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }

        const json = (await res.json()) as unknown;
        if (!cancelled) setTemplate((json ?? null) as Template | null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load template";
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const title = String(template?.name ?? "").trim() || "Untitled template";
  const pages = useMemo(() => parsePages(template?.pages), [template?.pages]);

  async function onPickLogo(file: File | null) {
    if (!file) {
      setLogoDataUrl(null);
      return;
    }
    const ok =
      file.type === "image/png" ||
      file.type === "image/jpeg" ||
      file.type === "image/jpg" ||
      file.type === "image/svg+xml" ||
      file.name.toLowerCase().endsWith(".svg");
    if (!ok) {
      alert("Please use PNG, JPG, or SVG.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result;
      if (typeof res === "string") setLogoDataUrl(res);
    };
    reader.readAsDataURL(file);
  }

  async function handleDownloadPdf() {
    try {
      setIsExporting(true);
      if (!logoDataUrl) {
        alert("Please upload a logo first.");
        return;
      }
      await downloadTemplatePdf({ templateName: title, pages, logoDataUrl });
    } catch (e) {
      console.error(e);
      alert("Could not create PDF. Please try again.");
    } finally {
      setIsExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="mt-1 p-4 text-sm text-gray-600">
        Loading template…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-1 p-4 text-sm text-red-200">
        Failed to load template.{" "}
        <span className="text-red-100/80">({error.length > 140 ? `${error.slice(0, 140)}…` : error})</span>
        <div className="mt-3">
          <Link href={backHref} className="text-xs text-zinc-200 underline underline-offset-2">
            {backLabel}
          </Link>
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="mt-1 p-4 text-sm text-zinc-200">
        Template not found.
        <div className="mt-3">
          <Link href={backHref} className="text-xs text-zinc-200 underline underline-offset-2">
            {backLabel}
          </Link>
        </div>
      </div>
    );
  }

  if (!showSidebar) {
    return (
      <div className="flex min-h-0 flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-gray-900">{title}</h1>
          <Link
            href={backHref}
            className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-900 hover:bg-gray-100"
          >
            Back
          </Link>
        </div>

        <div
          id={CAPTURE_ID}
          className="rounded-2xl border border-gray-200 bg-gray-100 p-4 h-full overflow-y-auto hide-scrollbar max-h-[calc(100dvh-9rem)]"
        >
          {pages.length > 0 ? (
            <LookbookPreview pages={pages} logoDataUrl={null} />
          ) : (
            <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-200">
              No pages/images found in this template.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 md:flex-row md:gap-6">
      <aside className="w-full shrink-0 rounded-xl border border-gray-200 bg-white p-4 shadow-xl backdrop-blur-sm md:w-[360px] md:self-start">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-gray-900">{title}</h1>
          <Link
            href={backHref}
            className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-900 hover:bg-gray-100"
          >
            Back
          </Link>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Upload logo</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/svg+xml,.svg"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void onPickLogo(f);
              e.target.value = "";
            }}
            className="w-full text-sm text-gray-900 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-blue-500"
          />

          {logoDataUrl ? (
            <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div
                className="h-12 w-12 overflow-hidden rounded-md border border-gray-200"
                style={{
                  backgroundImage: "repeating-conic-gradient(#3f3f46 0% 25%, #27272a 0% 50%)",
                  backgroundSize: "12px 12px",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoDataUrl} alt="Logo preview" className="h-full w-full object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-gray-600">Logo loaded</p>
                <button
                  type="button"
                  onClick={() => setLogoDataUrl(null)}
                  className="mt-1 text-xs text-red-400 hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">This logo will be included in the preview area.</p>
          )}
        </div>

        <div className="mt-4 border-t border-gray-200 pt-4">
          <button
            type="button"
            disabled={isExporting}
            onClick={() => void handleDownloadPdf()}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isExporting ? "Downloading…" : "Download PDF"}
          </button>
        </div>
      </aside>

      <div className="min-h-0 w-full flex-1">
        <div id={CAPTURE_ID} className="rounded-2xl border border-gray-200 bg-gray-100 p-4 h-full overflow-y-auto hide-scrollbar max-h-[calc(100dvh-6rem)]">

          {pages.length > 0 ? (
            <LookbookPreview pages={pages} logoDataUrl={logoDataUrl} />
          ) : (
            <div className="p-4 text-sm text-gray-900">
              No pages/images found in this template.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

