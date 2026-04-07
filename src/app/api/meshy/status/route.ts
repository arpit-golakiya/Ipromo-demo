import { NextRequest, NextResponse } from "next/server";

export type MeshyTaskStatus = {
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED";
  progress: number;
  modelUrl: string | null;
  error: string | null;
};

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
    const res = await fetch(
      `https://api.meshy.ai/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      },
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.message ?? `Meshy API returned ${res.status}` },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
      );
    }

    const result: MeshyTaskStatus = {
      status: data.status,
      progress: typeof data.progress === "number" ? data.progress : 0,
      modelUrl: data.model_urls?.glb ?? null,
      error: data.task_error?.message || null,
    };

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Request failed: ${msg}` }, { status: 502 });
  }
}
