import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UPSTREAM_URL = "https://api.remove.bg/v1.0/removebg";

function toDataUrl(buffer: ArrayBuffer, contentType: string): string {
  const b64 = Buffer.from(buffer).toString("base64");
  return `data:${contentType};base64,${b64}`;
}

export async function POST(req: Request) {
  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server misconfigured: missing REMOVE_BG_API_KEY" }, { status: 500 });
  }

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

  // Forward as multipart/form-data to remove.bg:
  // https://www.remove.bg/api#remove-background
  const upstreamForm = new FormData();
  upstreamForm.set("size", "auto");
  upstreamForm.set("image_file", image, image.name || "image.png");

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        accept: "image/png, application/json;q=0.9, */*;q=0.1",
      },
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

  // remove.bg typically returns raw PNG bytes; if JSON is returned, bubble it up for debugging.
  if (contentType.includes("application/json")) {
    const json = await upstreamRes.json().catch(() => null);
    return NextResponse.json({ error: "Upstream returned JSON (expected image/png)", details: json }, { status: 502 });
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

