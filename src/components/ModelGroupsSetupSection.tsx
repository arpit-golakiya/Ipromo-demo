"use client";

import { useState } from "react";
import type { ScrapedProduct } from "@/app/api/scrape/route";

function normalizeImageName(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const decodedPath = decodeURIComponent(u.pathname);
    const file = decodedPath.split("/").pop() ?? decodedPath;
    return file.toLowerCase().replace(/\.[a-z0-9]+$/i, "");
  } catch {
    const cleaned = decodeURIComponent(rawUrl);
    const file = cleaned.split("/").pop() ?? cleaned;
    return file.toLowerCase().replace(/\.[a-z0-9]+$/i, "");
  }
}

function deriveColorLabelForImage(
  imageUrl: string,
  scrapedImages: string[],
  scrapedColors: ScrapedProduct["colors"],
): { label: string; hex?: string } {
  const directIdx = scrapedImages.indexOf(imageUrl);
  if (directIdx >= 0 && scrapedColors[directIdx]?.label) {
    return {
      label: scrapedColors[directIdx].label,
      hex: scrapedColors[directIdx].hex,
    };
  }
  const imageToken = normalizeImageName(imageUrl);
  for (const c of scrapedColors) {
    const labelToken = c.label.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!labelToken) continue;
    if (imageToken.includes(labelToken)) {
      return { label: c.label, hex: c.hex };
    }
  }
  const oneBased = directIdx >= 0 ? directIdx + 1 : 1;
  return { label: `Image ${oneBased}` };
}

export type ImageGroup = {
  id: string;
  imageUrls: string[];
  /** Shown in lists / 3D batch; user-editable. */
  name: string;
};

export type GeneratedColorModelLite = {
  key: string;
  colorLabel?: string;
  colorHex?: string;
  status: string;
  fromPreload?: boolean;
};

type ModelGroupsSetupSectionProps = {
  scrapedImages: string[];
  scrapedColors: ScrapedProduct["colors"];
  groups: ImageGroup[];
  setGroups: React.Dispatch<React.SetStateAction<ImageGroup[]>>;
  selection: string[];
  setSelection: React.Dispatch<React.SetStateAction<string[]>>;
  groupIdRef: React.MutableRefObject<number>;
  availableUrls: string[];
  removeLogosFor3D: boolean;
  setRemoveLogosFor3D: React.Dispatch<React.SetStateAction<boolean>>;
  isGeneratingModel: boolean;
  modelGenerationProgress: number;
  modelGenerationError: string | null;
  generatedColorModels: GeneratedColorModelLite[];
  selectedModelKey: string | null;
  onSelectedModelKeyChange: (key: string | null) => void;
  onGenerateModelsBatch: (
    items: Array<{
      key: string;
      imageUrl: string;
      imageUrls?: string[];
      colorLabel?: string;
      colorHex?: string;
    }>,
    options?: { removeLogosFor3D?: boolean },
  ) => void;
  isStoringPreloaded: boolean;
  storePreloadedError: string | null;
  onStorePreloaded: () => void;
  setLightboxSrc: (src: string | null) => void;
};

export function ModelGroupsSetupSection({
  scrapedImages,
  scrapedColors,
  groups,
  setGroups,
  selection,
  setSelection,
  groupIdRef,
  availableUrls,
  removeLogosFor3D,
  setRemoveLogosFor3D,
  isGeneratingModel,
  modelGenerationProgress,
  modelGenerationError,
  generatedColorModels,
  selectedModelKey,
  onSelectedModelKeyChange,
  onGenerateModelsBatch,
  isStoringPreloaded,
  storePreloadedError,
  onStorePreloaded,
  setLightboxSrc,
}: ModelGroupsSetupSectionProps) {
  const [newGroupName, setNewGroupName] = useState("");
  const successCount = generatedColorModels.filter((m) => m.status === "SUCCEEDED").length;
  const failedCount = generatedColorModels.filter(
    (m) => m.status === "FAILED" || m.status === "EXPIRED",
  ).length;

  return (
    <>
      {groups.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Your groups ({groups.length})
          </span>
          {groups.map((group, idx) => (
            <div
              key={group.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-950/20 px-2 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Group name
                  </label>
                  <input
                    type="text"
                    value={group.name}
                    onChange={(e) =>
                      setGroups((gs) =>
                        gs.map((x) => (x.id === group.id ? { ...x, name: e.target.value } : x)),
                      )
                    }
                    maxLength={80}
                    placeholder={`Group ${idx + 1}`}
                    className="w-full max-w-[min(100%,280px)] rounded-md border border-white/15 bg-black/35 px-2 py-1.5 text-xs text-zinc-100 outline-none ring-emerald-500/25 focus:ring-2"
                    aria-label={`Name for group ${idx + 1}`}
                  />
                  <span className="text-[11px] text-zinc-500">
                    {group.imageUrls.length} photo{group.imageUrls.length === 1 ? "" : "s"} → 1 model
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.imageUrls.map((url) => (
                    <button
                      key={url}
                      type="button"
                      title="View larger"
                      onClick={() => setLightboxSrc(url)}
                      className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-white/10 ring-1 ring-white/5"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGroups((g) => g.filter((x) => x.id !== group.id))}
                className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-300 hover:border-red-500/40 hover:bg-red-950/40 hover:text-red-200"
              >
                Remove group
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Available photos ({availableUrls.length})
          </span>
          {selection.length > 0 && (
            <button
              type="button"
              className="text-[11px] text-zinc-400 underline decoration-zinc-600 hover:text-zinc-200"
              onClick={() => setSelection([])}
            >
              Clear selection
            </button>
          )}
        </div>
        {availableUrls.length === 0 ? (
          <p className="text-xs text-zinc-500">
            Every photo is in a group. Remove a group to move photos back here.
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {availableUrls.map((url) => (
              <label
                key={url}
                className={`relative flex shrink-0 cursor-pointer flex-col items-center gap-1 rounded-lg border p-1.5 transition ${
                  selection.includes(url)
                    ? "border-indigo-500 bg-indigo-950/40 ring-1 ring-indigo-500/40"
                    : "border-white/10 bg-black/30 hover:border-white/25"
                }`}
              >
                <div className="relative h-14 w-14 overflow-hidden rounded-md">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <input
                  type="checkbox"
                  checked={selection.includes(url)}
                  disabled={!selection.includes(url) && selection.length >= 5}
                  onChange={(e) => {
                    setSelection((prev) =>
                      e.target.checked ? [...prev, url] : prev.filter((u) => u !== url),
                    );
                  }}
                  className="h-3.5 w-3.5 accent-indigo-500 disabled:opacity-40"
                  aria-label="Select for next group"
                />
              </label>
            ))}
          </div>
        )}
        <p className="mt-1 text-[11px] text-zinc-500">
          Selected: {selection.length}
          {selection.length > 5 ? " — only the first 5 will be added to one group." : ""}
        </p>
      </div>

      {!isGeneratingModel && (
        <div className="mt-4 flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-zinc-400">
              Name for next group <span className="font-normal text-zinc-500">(optional)</span>
            </span>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              maxLength={80}
              placeholder="e.g. Black Tile, Navy hoodie…"
              className="rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-zinc-200 outline-none ring-indigo-500/25 focus:ring-2"
            />
          </label>
          <button
            type="button"
            disabled={selection.length === 0}
            onClick={() => {
              if (selection.length === 0) return;
              const urls = selection.slice(0, 5);
              groupIdRef.current += 1;
              setGroups((g) => {
                const trimmed = newGroupName.trim();
                const name = trimmed || `Group ${g.length + 1}`;
                return [...g, { id: `group-${groupIdRef.current}`, imageUrls: urls, name }];
              });
              setSelection([]);
              setNewGroupName("");
            }}
            className="w-full rounded-lg border border-indigo-500/40 bg-indigo-950/40 px-3 py-2.5 text-sm font-medium text-indigo-100 transition hover:bg-indigo-900/50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {selection.length === 0
              ? "Create group from selection (select photos first)"
              : `Create group (${Math.min(5, selection.length)} photo${Math.min(5, selection.length) === 1 ? "" : "s"})`}
          </button>

          <button
            type="button"
            disabled={groups.length === 0}
            onClick={() => {
              if (groups.length === 0) return;
              const items = groups.map((group) => {
                const first = group.imageUrls[0];
                const match = deriveColorLabelForImage(first, scrapedImages, scrapedColors);
                const trimmed = group.name.trim();
                const colorLabel = trimmed || match.label;
                return {
                  key: group.id,
                  imageUrl: first,
                  imageUrls: group.imageUrls.length > 1 ? group.imageUrls : undefined,
                  colorLabel,
                  colorHex: match.hex,
                };
              });
              onGenerateModelsBatch(items, { removeLogosFor3D });
            }}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {groups.length === 0
              ? "Generate 3D for all groups (add at least one group)"
              : `Generate 3D for all groups (${groups.length})`}
          </button>
        </div>
      )}

      {isGeneratingModel && (
        <div className="mt-4 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="flex items-center gap-1.5">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              {removeLogosFor3D ? "Cleaning photos, then converting to 3D…" : "Converting to 3D…"}
            </span>
            <span className="font-mono">{modelGenerationProgress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-700">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${modelGenerationProgress}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500">
            This usually takes a few minutes per group. You can close this window and use the
            sidebar to check progress.
          </p>
        </div>
      )}

      {!isGeneratingModel && (successCount > 0 || failedCount > 0) && (
        <div className="mt-4 space-y-1">
          <p className="text-xs text-emerald-400">
            ✓ Generated {successCount} model{successCount === 1 ? "" : "s"}
            {failedCount > 0 ? ` (${failedCount} failed)` : ""}
          </p>
          {successCount > 0 && (
            <select
              value={selectedModelKey ?? ""}
              onChange={(e) => onSelectedModelKeyChange(e.target.value || null)}
              className="w-full rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-zinc-200"
            >
              <option value="">Select generated model to preview</option>
              {generatedColorModels
                .filter((m) => m.status === "SUCCEEDED")
                .map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.colorLabel ?? m.key}
                    {m.fromPreload ? " (preloaded)" : ""}
                  </option>
                ))}
            </select>
          )}
        </div>
      )}

      {modelGenerationError && !isGeneratingModel && (
        <p className="mt-2 text-xs text-red-400">{modelGenerationError}</p>
      )}

      <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-zinc-400 select-none">
        <div
          role="checkbox"
          aria-checked={removeLogosFor3D}
          onClick={() => setRemoveLogosFor3D((v) => !v)}
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
            removeLogosFor3D ? "bg-indigo-600" : "bg-zinc-600"
          }`}
        >
          <span
            className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
              removeLogosFor3D ? "translate-x-3.5" : "translate-x-0.5"
            }`}
          />
        </div>
        <span>
          Clean photo first (remove people &amp; on-product branding — any product; OpenAI, slower)
        </span>
      </label>

      {!isGeneratingModel && successCount > 0 && (
        <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4">
          <button
            type="button"
            disabled={isStoringPreloaded}
            onClick={onStorePreloaded}
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-100 transition hover:bg-white/10 disabled:opacity-60"
          >
            {isStoringPreloaded ? "Storing..." : "Store generated models for preload"}
          </button>
          {storePreloadedError && <p className="text-xs text-red-400">{storePreloadedError}</p>}
        </div>
      )}
    </>
  );
}
