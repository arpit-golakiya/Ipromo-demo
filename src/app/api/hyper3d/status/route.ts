import { NextRequest, NextResponse } from "next/server";
import { getHyper3dTaskStatus, type Hyper3dTaskStatus } from "@/lib/hyper3d";

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "Missing ?taskId= parameter" }, { status: 400 });
  }

  try {
    const result: Hyper3dTaskStatus = await getHyper3dTaskStatus(taskId);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Request failed: ${msg}` }, { status: 502 });
  }
}
