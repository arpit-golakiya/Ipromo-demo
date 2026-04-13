import { NextRequest, NextResponse } from "next/server";
import { startRodinTask } from "@/lib/hyper3d";

/** Logo cleanup via OpenAI can exceed default serverless limits. */
export const maxDuration = 300;

function resolveImageUrls(body: {
  imageUrl?: unknown;
  imageUrls?: unknown;
}): string[] {
  if (Array.isArray(body.imageUrls) && body.imageUrls.length > 0) {
    return body.imageUrls.filter((u): u is string => typeof u === "string" && u.trim() !== "").slice(0, 5);
  }
  if (typeof body.imageUrl === "string" && body.imageUrl.trim()) {
    return [body.imageUrl.trim()];
  }
  return [];
}

export async function POST(req: NextRequest) {
  let imageUrls: string[];
  let removeLogosFor3D = false;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    imageUrls = resolveImageUrls(body);
    removeLogosFor3D = body.removeLogosFor3D === true;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (imageUrls.length === 0) {
    return NextResponse.json(
      { error: "Missing imageUrl or imageUrls in request body" },
      { status: 400 },
    );
  }

  try {
    const taskId = await startRodinTask({ imageUrls, removeLogosFor3D });
    return NextResponse.json({ taskId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Request failed: ${msg}` }, { status: 502 });
  }
}
