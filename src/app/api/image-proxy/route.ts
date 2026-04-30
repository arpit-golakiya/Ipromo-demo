import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isPrivateHost(hostname: string) {
  const h = hostname.trim().toLowerCase();
  if (h === "localhost") return true;
  if (h === "127.0.0.1" || h === "0.0.0.0") return true;
  // Very small SSRF guard for RFC1918-ish names; not perfect but helps.
  if (h.endsWith(".local")) return true;
  return false;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("url") ?? "";
  if (!raw) {
    return NextResponse.json({ error: "Missing query param: url" }, { status: 400 });
  }

  let target: URL;
  try {
    // Allow relative URLs (same-origin assets) too.
    target = new URL(raw, req.url);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "Unsupported protocol" }, { status: 400 });
  }
  if (isPrivateHost(target.hostname)) {
    return NextResponse.json({ error: "Blocked host" }, { status: 400 });
  }

  // Fetch bytes server-side, so the browser sees a same-origin image (canvas-safe).
  const upstream = await fetch(target.toString(), {
    // Avoid sending cookies/credentials to third-party.
    redirect: "follow",
    cache: "no-store",
    headers: {
      // Some CDNs require a UA; harmless here.
      "user-agent": "ipromo-image-proxy",
      accept: "image/*,*/*;q=0.8",
    },
  }).catch((e) => e as Error);

  if (upstream instanceof Error) {
    return NextResponse.json({ error: upstream.message || "Upstream fetch failed" }, { status: 502 });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Upstream HTTP ${upstream.status}`, details: text.slice(0, 4000) },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const buf = await upstream.arrayBuffer();

  // Cache a bit (safe: keyed by full URL querystring).
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
    },
  });
}

