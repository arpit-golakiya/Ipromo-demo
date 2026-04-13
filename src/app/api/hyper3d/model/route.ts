import { NextRequest, NextResponse } from "next/server";
import { decodeHyper3dJobRef, fetchRodinGlbDownloadUrl } from "@/lib/hyper3d";

function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim(),
  );
}

/**
 * Proxies the generated GLB to the browser (avoids CORS on Hyper3D / CDN URLs).
 */
export async function GET(req: NextRequest) {
  const taskToken = req.nextUrl.searchParams.get("taskId");
  if (!taskToken) {
    return NextResponse.json({ error: "Missing ?taskId= parameter" }, { status: 400 });
  }

  const ref = decodeHyper3dJobRef(taskToken);
  const taskUuid = ref?.taskUuid ?? (looksLikeUuid(taskToken) ? taskToken.trim() : null);
  if (!taskUuid) {
    return NextResponse.json({ error: "Invalid task reference" }, { status: 400 });
  }

  try {
    const glbUrl = await fetchRodinGlbDownloadUrl(taskUuid);

    const modelRes = await fetch(glbUrl);
    if (!modelRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch model: HTTP ${modelRes.status}` },
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
    const lower = msg.toLowerCase();
    if (lower.includes("404") || lower.includes("not ready") || lower.includes("no files")) {
      return NextResponse.json(
        { error: "GLB not available yet — task may still be processing" },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: `Proxy failed: ${msg}` }, { status: 502 });
  }
}
