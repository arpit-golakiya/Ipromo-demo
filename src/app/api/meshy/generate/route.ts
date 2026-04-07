import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Meshy API key not configured on the server" },
      { status: 500 },
    );
  }

  let imageUrl: string;
  try {
    const body = await req.json();
    imageUrl = body.imageUrl;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!imageUrl || typeof imageUrl !== "string") {
    return NextResponse.json({ error: "Missing imageUrl in request body" }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.meshy.ai/openapi/v1/image-to-3d", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        enable_pbr: true,
        should_remesh: true,
        should_texture: true,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.message ?? `Meshy API returned ${res.status}` },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
      );
    }

    // Meshy POST returns { result: "task-id" }
    const taskId: string = data.result ?? data.id;
    if (!taskId) {
      return NextResponse.json(
        { error: "Unexpected response from Meshy — no task ID returned" },
        { status: 502 },
      );
    }

    return NextResponse.json({ taskId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Request failed: ${msg}` }, { status: 502 });
  }
}
