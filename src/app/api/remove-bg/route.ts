import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UPSTREAM_URL = "https://ipromollc-rmbg-api.hf.space/remove-bg";

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

function pickImagePayload(json: JsonValue): { base64?: string; dataUrl?: string; url?: string } | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, JsonValue>;

  const readString = (v: JsonValue): string | null => (typeof v === "string" && v.trim() ? v : null);

  // Common shapes:
  // - { dataUrl: "data:image/png;base64,..." }
  // - { image: "data:image/png;base64,..." } or { image: "<base64>" }
  // - { result: { ... } } nesting
  const candidates: Array<JsonValue> = [
    obj.dataUrl,
    obj.image,
    obj.output,
    obj.result,
    obj.data,
  ].filter((v) => v != null);

  for (const c of candidates) {
    if (typeof c === "string") {
      const s = c.trim();
      if (s.startsWith("data:image/")) return { dataUrl: s };
      // Might be raw base64
      if (/^[a-zA-Z0-9+/=\r\n]+$/.test(s) && s.length > 100) return { base64: s };
      if (s.startsWith("http://") || s.startsWith("https://")) return { url: s };
      continue;
    }
    if (c && typeof c === "object") {
      const nested = pickImagePayload(c);
      if (nested) return nested;
    }
  }

  // Some APIs: { image: { url: "..." } }
  const imageObj = obj.image;
  if (imageObj && typeof imageObj === "object") {
    const url = readString((imageObj as Record<string, JsonValue>).url);
    if (url) return { url };
  }

  return null;
}

function toDataUrl(buffer: ArrayBuffer, contentType: string): string {
  const b64 = Buffer.from(buffer).toString("base64");
  return `data:${contentType};base64,${b64}`;
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const image = form.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "Missing form field: image" }, { status: 400 });
  }

  // Forward as multipart/form-data to the upstream.
  const upstreamForm = new FormData();
  upstreamForm.set("image", image, image.name || "image.png");

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: { accept: "application/json" },
      body: upstreamForm,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upstream request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!upstreamRes.ok) {
    const text = await upstreamRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Upstream error: HTTP ${upstreamRes.status}`, details: text.slice(0, 4000) },
      { status: 502 },
    );
  }

  const contentType = (upstreamRes.headers.get("content-type") ?? "").toLowerCase();

  // If upstream returns JSON, attempt to extract a data URL / base64 / URL.
  if (contentType.includes("application/json")) {
    let json: JsonValue;
    try {
      json = (await upstreamRes.json()) as JsonValue;
    } catch {
      return NextResponse.json({ error: "Upstream returned invalid JSON" }, { status: 502 });
    }

    const payload = pickImagePayload(json);
    if (!payload) {
      return NextResponse.json({ error: "Upstream JSON did not include an image payload", json }, { status: 502 });
    }

    if (payload.dataUrl) {
      return NextResponse.json({ dataUrl: payload.dataUrl });
    }

    if (payload.base64) {
      // Assume png if not specified.
      return NextResponse.json({ dataUrl: `data:image/png;base64,${payload.base64.replace(/\s+/g, "")}` });
    }

    if (payload.url) {
      try {
        const imgRes = await fetch(payload.url);
        if (!imgRes.ok) {
          return NextResponse.json({ error: `Upstream image URL fetch failed: HTTP ${imgRes.status}` }, { status: 502 });
        }
        const imgType = (imgRes.headers.get("content-type") ?? "image/png").split(";")[0];
        const buf = await imgRes.arrayBuffer();
        return NextResponse.json({ dataUrl: toDataUrl(buf, imgType) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fetch upstream image URL";
        return NextResponse.json({ error: msg }, { status: 502 });
      }
    }

    return NextResponse.json({ error: "Upstream JSON image payload unsupported" }, { status: 502 });
  }

  // If upstream returns raw image bytes (likely PNG), convert to a data URL.
  if (contentType.startsWith("image/")) {
    const buf = await upstreamRes.arrayBuffer();
    const imgType = contentType.split(";")[0] || "image/png";
    return NextResponse.json({ dataUrl: toDataUrl(buf, imgType) });
  }

  // Unknown content-type; still attempt to treat it as bytes.
  const buf = await upstreamRes.arrayBuffer();
  return NextResponse.json({ dataUrl: toDataUrl(buf, "image/png") });
}

