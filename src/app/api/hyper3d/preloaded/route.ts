import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase";

const TABLE = "preloaded_models";

function normalizeProductUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    return u.toString();
  } catch {
    return raw.trim();
  }
}

export async function GET(req: NextRequest) {
  const productUrl = req.nextUrl.searchParams.get("productUrl");
  if (!productUrl) {
    return NextResponse.json({ error: "Missing ?productUrl= parameter" }, { status: 400 });
  }

  try {
    const supabase = createServerSupabaseAdminClient();
    const normalized = normalizeProductUrl(productUrl);
    const { data, error } = await supabase
      .from(TABLE)
      .select("product_url,color_label,color_hex,image_url,task_id,glb_url")
      .eq("product_url", normalized)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to fetch preloaded models" },
        { status: 502 },
      );
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
