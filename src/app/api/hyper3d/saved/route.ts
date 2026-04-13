import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase";

const TABLE = "preloaded_models";

export async function GET(req: NextRequest) {
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? "120");
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 300) : 120;

  try {
    const supabase = createServerSupabaseAdminClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("product_url,color_key,color_label,color_hex,image_url,task_id,glb_url,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to fetch saved models" },
        { status: 502 },
      );
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
