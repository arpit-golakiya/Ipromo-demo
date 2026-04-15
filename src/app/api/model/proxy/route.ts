import { NextRequest, NextResponse } from "next/server";

function isAllowedSourceUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    // Allowlist the Hyper3D file host (signed URLs).
    if (u.hostname !== "file.hyper3d.com") return false;
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get("src");
  if (!src) {
    return NextResponse.json({ error: "Missing ?src=" }, { status: 400 });
  }
  if (!isAllowedSourceUrl(src)) {
    return NextResponse.json({ error: "Blocked source URL" }, { status: 400 });
  }

  try {
    const upstream = await fetch(src, {
      // Some signed CDNs behave better with an explicit UA.
      headers: { "User-Agent": "Ipromo-demo/1.0 (+nextjs)" },
      // Cache on the server/CDN side; the signed URL itself encodes freshness.
      cache: "force-cache",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream fetch failed (${upstream.status})` },
        { status: 502 },
      );
    }

    const buf = await upstream.arrayBuffer();
    const contentType =
      upstream.headers.get("content-type") ?? "model/gltf-binary";
    const contentDisposition = upstream.headers.get("content-disposition");

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    if (contentDisposition) headers.set("Content-Disposition", contentDisposition);
    headers.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");

    // Same-origin response => no browser CORS needed. (These headers are harmless anyway.)
    headers.set("Access-Control-Allow-Origin", "*");

    return new NextResponse(buf, { status: 200, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}