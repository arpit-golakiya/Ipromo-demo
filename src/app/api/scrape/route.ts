import { NextRequest, NextResponse } from "next/server";

export type ScrapedProduct = {
  name: string;
  colors: Array<{ label: string; hex: string }>;
  images: string[];
  description: string;
};

// ── Color name → hex lookup ──────────────────────────────────────────────────
const COLOR_HEX: Record<string, string> = {
  black: "#1a1a1a",
  white: "#f5f5f5",
  "off white": "#f5f0e8",
  red: "#c0392b",
  "dark red": "#8b0000",
  maroon: "#7f1d1d",
  burgundy: "#800020",
  navy: "#1b2a4a",
  "navy blue": "#1b2a4a",
  "dark navy": "#111827",
  royal: "#2e5dcc",
  "royal blue": "#2e5dcc",
  blue: "#2563eb",
  "light blue": "#93c5fd",
  "columbia blue": "#a8c8e8",
  "carolina blue": "#4fa3d1",
  "powder blue": "#b0d4e8",
  "sky blue": "#7dd3fc",
  green: "#2d6a4f",
  "forest green": "#2d6a4f",
  forest: "#2d6a4f",
  "kelly green": "#22c55e",
  "dark green": "#14532d",
  olive: "#4d5016",
  lime: "#84cc16",
  teal: "#0d9488",
  turquoise: "#06b6d4",
  grey: "#6b7280",
  gray: "#6b7280",
  charcoal: "#374151",
  "dark grey": "#4b5563",
  "dark gray": "#4b5563",
  "heather grey": "#9ca3af",
  "heather gray": "#9ca3af",
  "sport grey": "#9ca3af",
  "light grey": "#d1d5db",
  "light gray": "#d1d5db",
  silver: "#c0c0c0",
  orange: "#ea580c",
  "burnt orange": "#c2410c",
  purple: "#7c3aed",
  "dark purple": "#4c1d95",
  lavender: "#c4b5fd",
  pink: "#ec4899",
  "hot pink": "#db2777",
  coral: "#f87171",
  brown: "#92400e",
  tan: "#d2b48c",
  khaki: "#c3b091",
  yellow: "#eab308",
  gold: "#d97706",
  "old gold": "#c59b00",
  "metallic gold": "#d4af37",
  "athletic gold": "#f59e0b",
};

function nameToHex(raw: string): string {
  const key = raw.toLowerCase().trim();
  if (COLOR_HEX[key]) return COLOR_HEX[key];
  // Try partial match
  for (const [k, v] of Object.entries(COLOR_HEX)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return "#888888";
}

// ── HTML parsing helpers ─────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim();
}

function extractName(html: string): string {
  // og:title meta (most reliable)
  let m = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (m) return m[1].replace(/\s*[|–-]\s*iPromo.*/i, "").trim();

  // h1 with page-title class (Magento)
  m = html.match(/<h1[^>]*class=["'][^"']*page-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (m) return stripTags(m[1]);

  // itemprop="name" span
  m = html.match(/<(?:span|h1)[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/(?:span|h1)>/i);
  if (m) return stripTags(m[1]);

  // <title> tag fallback
  m = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (m) return m[1].replace(/\s*[|–-]\s*iPromo.*/i, "").trim();

  return "iPromo Product";
}

function extractColors(html: string): Array<{ label: string; hex: string }> {
  const seen = new Set<string>();
  const results: Array<{ label: string; hex: string }> = [];

  const add = (label: string, hex?: string) => {
    const key = label.toLowerCase().trim();
    if (!key || key.length < 2 || seen.has(key)) return;
    seen.add(key);
    results.push({ label: label.trim(), hex: hex ?? nameToHex(label) });
  };
  const ipromoColorPairs = html.matchAll(
    /\\?"option_value\\?"\s*:\s*\\?"(#[0-9a-fA-F]{3,8})\\?"\s*,\s*\\?"option_label\\?"\s*:\s*\\?"([^"\\]{1,60})\\?"/gi,
  );
  for (const m of ipromoColorPairs) {
    add(m[2], m[1]);   // label = m[2], hex = m[1]
  }

  // Reversed-order fallback: label before value
  const ipromoColorPairsRev = html.matchAll(
    /\\?"option_label\\?"\s*:\s*\\?"([^"\\]{1,60})\\?"[\s\S]{0,120}?\\?"option_value\\?"\s*:\s*\\?"(#[0-9a-fA-F]{3,8})\\?"/gi,
  );
  for (const m of ipromoColorPairsRev) {
    add(m[1], m[2]);
  }

  // ── Strategy 2: iPromo associate_products color names ───────────────────
  // Fallback: extract color from product variant names like
  // "Crosswind Quarter Zip Sweatshirt-Navy (NY)" → "Navy (NY)"
  if (results.length === 0) {
    const assocNames = html.matchAll(
      /"name"\s*:\s*"[^"]*?-([^"]{2,40}?)(?:\\u0022|")(?:,|\})/gi,
    );
    for (const m of assocNames) {
      const colorPart = m[1].trim();
      if (colorPart && !/^\d/.test(colorPart) && colorPart.length < 40) {
        add(colorPart);
      }
    }
  }

  // ── Strategy 3: Magento swatch HTML attributes ───────────────────────────
  if (results.length === 0) {
    const swatchAttrs = html.matchAll(
      /(?:data-option-label|option-label)=["']([^"']{2,40})["'](?:[^>]*(?:data-option-tooltip-value|option-tooltip-value)=["'](#[0-9a-fA-F]{3,6})["'])?/gi,
    );
    for (const m of swatchAttrs) add(m[1], m[2]);
  }

  // ── Strategy 4: Generic JSON "label"/"value" pairs ───────────────────────
  if (results.length === 0) {
    const jsonBlocks = html.matchAll(
      /\\?"label\\?"\s*:\s*\\?"([^"\\]{2,40})\\?"\s*(?:,\s*[^}]{0,80}?)?\\?"value\\?"\s*:\s*\\?"(#[0-9a-fA-F]{3,6})\\?"/gi,
    );
    for (const m of jsonBlocks) {
      if (!/^\d+$/.test(m[1])) add(m[1], m[2]);
    }
  }

  // ── Strategy 5: <select> options matching known color names ─────────────
  if (results.length === 0) {
    const opts = html.matchAll(/<option[^>]*>([^<]{2,40})<\/option>/gi);
    for (const m of opts) {
      const label = stripTags(m[1]);
      if (COLOR_HEX[label.toLowerCase()]) add(label);
    }
  }

  return results;
}

function extractImages(html: string, baseUrl: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  const stripYouMayAlsoLikeSections = (input: string): string => {
    let output = input;
    const markerRe = /You\s+May\s+Also\s+Like/i;

    while (true) {
      const marker = markerRe.exec(output);
      if (!marker || marker.index < 0) break;

      const headingStart = output.lastIndexOf("<h2", marker.index);
      if (headingStart < 0) break;

      const sectionStart = output.lastIndexOf("<div", headingStart);
      if (sectionStart < 0) break;

      const tagRe = /<\/?div\b[^>]*>/gi;
      tagRe.lastIndex = sectionStart;

      let depth = 0;
      let sectionEnd = -1;
      let foundStart = false;

      for (let m = tagRe.exec(output); m; m = tagRe.exec(output)) {
        const tag = m[0];
        const isClosing = /^<\//.test(tag);

        if (!foundStart) {
          foundStart = true;
          depth = 1;
          continue;
        }

        if (!isClosing) {
          depth += 1;
        } else {
          depth -= 1;
          if (depth === 0) {
            sectionEnd = tagRe.lastIndex;
            break;
          }
        }
      }

      if (sectionEnd <= sectionStart) break;
      output = `${output.slice(0, sectionStart)}${output.slice(sectionEnd)}`;
    }

    return output;
  };

  const htmlWithoutRelated = stripYouMayAlsoLikeSections(html);
  const relatedImageBlacklist = new Set<string>();

  const relatedMarker = /You\s+May\s+Also\s+Like/i.exec(html);
  if (relatedMarker?.index !== undefined) {
    const relatedChunk = html.slice(Math.max(0, relatedMarker.index - 2000));

    // Encoded Next.js optimizer URLs in related-products cards:
    // /_next/image?url=https%3A%2F%2F...cloudfront...jpg&w=640&q=75
    for (const m of relatedChunk.matchAll(/[?&]url=(https?%3A%2F%2F[^"'&\s<>]+)/gi)) {
      try {
        const decoded = decodeURIComponent(m[1]).replace(/\\/g, "");
        relatedImageBlacklist.add(decoded);
      } catch {
        // ignore malformed encodings
      }
    }

    // Direct CDN URLs that might appear in inline JSON/script payloads.
    for (const m of relatedChunk.matchAll(
      /https?:\/\/[a-zA-Z0-9.-]+\.cloudfront\.net\/catalog\/product\/[^"'\\\s<>]+\.(?:jpg|jpeg|png|webp)/gi,
    )) {
      relatedImageBlacklist.add(m[0].replace(/\\/g, ""));
    }
  }

  const add = (url: string) => {
    try {
      // Resolve relative paths and strip escaped backslashes from RSC payloads
      const clean = url.replace(/\\/g, "");
      const abs = clean.startsWith("http") ? clean : new URL(clean, baseUrl).href;
      if (seen.has(abs)) return;
      if (relatedImageBlacklist.has(abs)) return;
      // Skip icons, logos, banners, and tracking pixels (path-level only)
      if (/\/(icon|logo|banner|sprite|pixel|badge|flag)\b/i.test(abs)) return;
      if (/\.(svg|gif|ico)(\?|$)/i.test(abs)) return;
      if (/[?&]w=\d{1,2}&/i.test(abs)) return; // tiny thumbnail query params
      seen.add(abs);
      results.push(abs);
    } catch {
      // ignore malformed URLs
    }
  };

  // ── Strategy 1: og:image (primary product photo) ────────────────────────
  const ogMatch = htmlWithoutRelated.match(
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
  );
  const ogUrl = ogMatch?.[1] ?? null;
  if (ogUrl) add(ogUrl);

  // ── Strategy 2: SKU-prefix match (color variants of the primary product) ──
  // iPromo product images share a SKU prefix in their filename, e.g.:
  //   og:image = ".../l85094a_navy.jpg"  →  prefix = "l85094a"
  //   variant  = ".../l85094a_heather.jpg" (same product, different color)
  // We extract the prefix and find all cloudfront URLs sharing it, so the
  // "Generate 3D" panel shows images of the SAME product (not related ones).
  if (ogUrl) {
    const fname = (ogUrl.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
    // Grab the first segment of the filename before an underscore/hyphen/dot
    // that follows at least 4 alphanumeric characters.
    const prefix = fname.match(/^([a-zA-Z0-9]{4,})/)?.[1];
    if (prefix) {
      const skuRe = new RegExp(
        `https?://[a-zA-Z0-9.-]+\\.cloudfront\\.net/catalog/product/[^"'\\\\\\s<>]*${prefix}[^"'\\\\\\s<>]*\\.(?:jpg|jpeg|png|webp)`,
        "gi",
      );
      for (const m of htmlWithoutRelated.matchAll(skuRe)) add(m[0]);
    }
  }

  // ── Strategy 3: iPromo RSC "image":[…] variant arrays ────────────────────
  // iPromo's Next.js RSC payload embeds per-variant image lists as:
  //   "image":["https://...jpg","https://...jpg"]  (plain JSON in script tags)
  // or backslash-escaped inside self.__next_f.push() strings:
  //   \"image\":[\"https://...jpg\",\"https://...jpg\"]
  // The \\?" makes the leading backslash optional so both forms are covered.
  for (const arrayMatch of htmlWithoutRelated.matchAll(
    /\\?"image\\?"\s*:\s*\[([^\]]{1,4000})\]/gi,
  )) {
    for (const urlMatch of arrayMatch[1].matchAll(
      /https?:\\?\/\\?\/[a-zA-Z0-9.-]+\.cloudfront\.net\/catalog\/product\/[^"'\\\s]+\.(?:jpg|jpeg|png|webp)/gi,
    )) {
      add(urlMatch[0]);
    }
  }

  // ── Strategy 4: All cloudfront.net/catalog/product URLs (broad catch) ─────
  // iPromo serves ALL product images through their CloudFront CDN
  // (e.g. dcridil0zrtkb.cloudfront.net). This catches any that slipped
  // through the more targeted strategies above.
  for (const m of htmlWithoutRelated.matchAll(
    /https?:\/\/[a-zA-Z0-9.-]+\.cloudfront\.net\/catalog\/product\/[^"'\\\s<>]+\.(?:jpg|jpeg|png|webp)/gi,
  )) {
    add(m[0]);
  }

  // ── Strategy 5: RSC individual image field strings ────────────────────────
  for (const m of htmlWithoutRelated.matchAll(
    /"(?:image_url|thumbnail_url|small_image|base_image)"\s*:\s*"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi,
  )) {
    add(m[1]);
  }

  // ── Strategy 6: Relative /catalog/product/ path entries ──────────────────
  for (const m of htmlWithoutRelated.matchAll(
    /"(?:file|url)"\s*:\s*"(\/catalog\/product\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi,
  )) {
    add(m[1]);
  }

  // ── Strategy 7: <img> tags — ipromo.com domain or cloudfront CDN ─────────
  for (const m of htmlWithoutRelated.matchAll(
    /<img[^>]+src=["']((?:https?:)?\/\/[^"']*(?:ipromo|cloudfront)[^"']*\.(?:jpg|jpeg|png|webp)[^"']*)/gi,
  )) {
    const url = m[1].startsWith("//") ? `https:${m[1]}` : m[1];
    add(url);
  }

  // Return all discovered product images after dedupe/filtering.
  return results;
}

function extractDescription(html: string): string {
  // og:description
  let m = html.match(
    /<meta[^>]*(?:name=["']description["']|property=["']og:description["'])[^>]*content=["']([^"']{10,500})["']/i,
  );
  if (m) return m[1].trim().slice(0, 400);

  // Product description div (Magento pattern)
  m = html.match(
    /<div[^>]*class=["'][^"']*product[^"']*description[^"']*["'][^>]*>([\s\S]{20,600}?)<\/div>/i,
  );
  if (m) return stripTags(m[1]).slice(0, 400);

  return "";
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");

  if (!rawUrl) {
    return NextResponse.json({ error: "Missing ?url= parameter" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!parsed.hostname.includes("ipromo.com")) {
    return NextResponse.json(
      { error: "Only ipromo.com URLs are supported" },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(rawUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Product page returned HTTP ${res.status}` },
        { status: 502 },
      );
    }

    const html = await res.text();

    const product: ScrapedProduct = {
      name: extractName(html),
      colors: extractColors(html),
      images: extractImages(html, rawUrl),
      description: extractDescription(html),
    };

    return NextResponse.json(product, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Fetch failed: ${msg}` }, { status: 502 });
  }
}
