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

function coerceString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function coerceHexColor(v: unknown): string | null {
  const s = coerceString(v);
  if (!s) return null;
  const hex = s.startsWith("#") ? s : `#${s}`;
  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : null;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  try {
    const supabase = createServerSupabaseAdminClient();

    let query = supabase.from(TABLE).select("*").order("id", { ascending: true });
    if (id) query = query.eq("id", id);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    const rows = Array.isArray(data) ? (data as unknown[]) : [];
    const first = (rows[0] ?? null) as Record<string, unknown> | null;

    const modelUrl = coerceModelUrl(first);

    if (!modelUrl) {
      return NextResponse.json(
        { error: "No model URL found in one_model_data" },
        { status: 404 },
      );
    }

    const variants = rows
      .map((r) => (r ?? null) as Record<string, unknown> | null)
      .filter((r): r is Record<string, unknown> => Boolean(r))
      .map((r) => ({
        id: coerceString(r.id) ?? String(r.id ?? ""),
        colorKey: coerceString(r.color_key) ?? coerceString(r.colorKey) ?? "",
        colorLabel: coerceString(r.color_label) ?? coerceString(r.colorLabel) ?? "Color",
        colorHex: coerceHexColor(r.color_hex) ?? coerceHexColor(r.colorHex),
        imageUrl: coerceString(r.image_url) ?? coerceString(r.imageUrl),
        glbUrl: coerceString(r.glb_url) ?? coerceString(r.glbUrl) ?? modelUrl,
        productUrl: coerceString(r.product_url) ?? coerceString(r.productUrl),
        productName: coerceString(r.product_name) ?? coerceString(r.productName),
      }))
      .filter((v) => Boolean(v.glbUrl));

    return NextResponse.json(
      {
        modelUrl,
        productName: coerceString(first?.product_name) ?? null,
        productUrl: coerceString(first?.product_url) ?? null,
        variants,
      },
      {
        headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
