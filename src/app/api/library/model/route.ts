import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase";

const TABLE = "preloaded_models";

export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "Missing ?id=" }, { status: 400 });
  }

  try {
    const supabase = createServerSupabaseAdminClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("glb_url")
      .eq("id", id)
      .single();

    if (error || !data?.glb_url) {
      return NextResponse.json({ error: error?.message ?? "Model not found" }, { status: 404 });
    }

    const glbUrl = String(data.glb_url);
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
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

