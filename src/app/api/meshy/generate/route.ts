import { NextRequest, NextResponse } from "next/server";
import { startMeshyTask } from "@/lib/meshy";

/** Logo/model cleanup via OpenAI can exceed default serverless limits. */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let imageUrl: string;
  let removeLogosFor3D = false;
  try {
    const body = await req.json();
    imageUrl = body.imageUrl;
    removeLogosFor3D = body.removeLogosFor3D === true;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!imageUrl || typeof imageUrl !== "string") {
    return NextResponse.json({ error: "Missing imageUrl in request body" }, { status: 400 });
  }

  try {
    const taskId = await startMeshyTask({ imageUrl, removeLogosFor3D });
    return NextResponse.json({ taskId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Request failed: ${msg}` }, { status: 502 });
  }
}
