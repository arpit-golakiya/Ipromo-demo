import { NextRequest, NextResponse } from "next/server";
import { getMeshyTaskStatus, type MeshyTaskStatus } from "@/lib/meshy";

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "Missing ?taskId= parameter" }, { status: 400 });
  }

  try {
    const result: MeshyTaskStatus = await getMeshyTaskStatus(taskId);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Request failed: ${msg}` }, { status: 502 });
  }
}
