"use client";

type Rgb = { r: number; g: number; b: number };

function clampByte(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHexByte(n: number) {
  return clampByte(n).toString(16).padStart(2, "0");
}

function rgbToHex({ r, g, b }: Rgb) {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`.toUpperCase();
}

function luminance({ r, g, b }: Rgb) {
  // sRGB relative luminance approximation
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function saturation({ r, g, b }: Rgb) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.loading = "eager";
  img.src = url;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load image"));
  });
  return img;
}

function extractCandidateColors(data: ImageData) {
  const { width, height } = data;
  const pixels = data.data;

  const step = Math.max(1, Math.floor(Math.max(width, height) / 140));
  const buckets = new Map<string, { count: number; rgb: Rgb }>();

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const a = pixels[i + 3] ?? 0;
      if (a < 18) continue;

      const r0 = pixels[i] ?? 0;
      const g0 = pixels[i + 1] ?? 0;
      const b0 = pixels[i + 2] ?? 0;

      // Skip near-white/near-black pixels; we want brand-ish colors.
      const lum = luminance({ r: r0, g: g0, b: b0 });
      if (lum > 0.97 || lum < 0.05) continue;

      // Quantize.
      const r = Math.round(r0 / 16) * 16;
      const g = Math.round(g0 / 16) * 16;
      const b = Math.round(b0 / 16) * 16;
      const key = `${r},${g},${b}`;
      const prev = buckets.get(key);
      if (prev) prev.count += 1;
      else buckets.set(key, { count: 1, rgb: { r, g, b } });
    }
  }

  return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
}

export async function pickBrandBackgroundHexFromImageUrl(imageUrl: string): Promise<string | null> {
  const img = await loadImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
  canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const candidates = extractCandidateColors(data);
  if (!candidates.length) return null;

  // Score: frequency * saturation bias; prefer vivid color that appears a lot.
  let best: { score: number; rgb: Rgb } | null = null;
  for (const c of candidates.slice(0, 40)) {
    const sat = saturation(c.rgb);
    const lum = luminance(c.rgb);
    // Prefer mid luminance backgrounds.
    const lumPenalty = Math.abs(lum - 0.55);
    const score = c.count * (0.4 + sat) * (1.2 - lumPenalty);
    if (!best || score > best.score) best = { score, rgb: c.rgb };
  }

  return best ? rgbToHex(best.rgb) : null;
}

