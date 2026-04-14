import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase";

const TABLE = "preloaded_models";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? "80");
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 80;

  try {
    const supabase = createServerSupabaseAdminClient();
    let query = supabase
      .from(TABLE)
      .select("id,product_name,color_label,image_url,glb_url,created_at")
      .not("glb_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (q) {
      query = query.ilike("product_name", `%${q}%`);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message ?? "Failed to search library" }, { status: 502 });
    }

    const rows = (data ?? []).filter(
      (row) => row && typeof (row as { glb_url?: unknown }).glb_url === "string",
    ) as Array<{
      id: string | number;
      product_name: string | null;
      color_label: string | null;
      image_url: string | null;
      glb_url: string | null;
    }>;

    const byProduct = new Map<
      string,
      {
        product_name: string;
        preview_image_url: string | null;
        variants: Array<{
          id: string;
          label: string;
          image_url: string | null;
        }>;
      }
    >();

    for (const row of rows) {
      const productName = String(row.product_name ?? "").trim();
      const glbUrl = String(row.glb_url ?? "").trim();
      if (!productName || !glbUrl) continue;

      const id = String(row.id);
      const label =
        String(row.color_label ?? "").trim() || "Variant";

      const group =
        byProduct.get(productName) ??
        (() => {
          const g = {
            product_name: productName,
            preview_image_url: typeof row.image_url === "string" ? row.image_url : null,
            variants: [] as Array<{ id: string; label: string; image_url: string | null }>,
          };
          byProduct.set(productName, g);
          return g;
        })();

      if (!group.preview_image_url && typeof row.image_url === "string") {
        group.preview_image_url = row.image_url;
      }

      group.variants.push({
        id,
        label,
        image_url: typeof row.image_url === "string" ? row.image_url : null,
      });
    }

    const products = Array.from(byProduct.values()).map((p) => ({
      ...p,
      variants: p.variants.sort((a, b) => a.label.localeCompare(b.label)),
    }));

    // Back-compat for older UI bundles that expect a flat `items[]`.
    const items = products.flatMap((p) =>
      p.variants.map((v) => ({
        id: v.id,
        name: p.product_name,
        image_url: v.image_url,
      })),
    );

    return NextResponse.json({ products, items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

