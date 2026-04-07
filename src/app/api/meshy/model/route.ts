import { NextRequest, NextResponse } from "next/server";

/**
 * Proxies a generated GLB model from the Meshy CDN to the browser.
 * Using a server-side proxy avoids CORS issues with Meshy's signed CDN URLs
 * and lets us fetch a fresh signed URL from the task (in case the original URL expired).
 */
export async function GET(req: NextRequest) {
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Meshy API key not configured on the server" },
      { status: 500 },
    );
  }

  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "Missing ?taskId= parameter" }, { status: 400 });
  }

  try {
    // Fetch the task to get a fresh signed model URL
    const statusRes = await fetch(
      `https://api.meshy.ai/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      },
    );

    if (!statusRes.ok) {
      return NextResponse.json(
        { error: `Task lookup failed: HTTP ${statusRes.status}` },
        { status: 404 },
      );
    }

    const task = await statusRes.json();
    const glbUrl: string | undefined = task.model_urls?.glb;

    if (!glbUrl) {
      return NextResponse.json(
        { error: "GLB model URL not available yet — task may still be processing" },
        { status: 404 },
      );
    }

    // Fetch the actual GLB binary from Meshy's CDN and stream it to the client
    const modelRes = await fetch(glbUrl);

    if (!modelRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch model from CDN: HTTP ${modelRes.status}` },
        { status: 502 },
      );
    }

    const buffer = await modelRes.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=600",
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Proxy failed: ${msg}` }, { status: 502 });
  }
}
