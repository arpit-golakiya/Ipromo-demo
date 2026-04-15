import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase";

const TABLE = "one_model_data";

function coerceModelUrl(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;

  const candidates: unknown[] = [
    row.model_url,
    row.modelUrl,
    row.glb_url,
    row.gltf_url,
    row.url,
    row.file_url,
  ];

  for (const v of candidates) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s) continue;
    return s;
  }

  // Fallback: first string that looks like a model URL.
  for (const v of Object.values(row)) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s) continue;
    const lower = s.toLowerCase();
    if (lower.endsWith(".glb") || lower.endsWith(".gltf")) return s;
  }

  return null;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  try {
    const supabase = createServerSupabaseAdminClient();

    let query = supabase.from(TABLE).select("*").limit(1);
    if (id) query = query.eq("id", id);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    const row = Array.isArray(data) ? data[0] : null;
    const modelUrl = coerceModelUrl((row ?? null) as Record<string, unknown> | null);

    if (!modelUrl) {
      return NextResponse.json(
        { error: "No model URL found in one_model_data" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { modelUrl, row },
      {
        headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
