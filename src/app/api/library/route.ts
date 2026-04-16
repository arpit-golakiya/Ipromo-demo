import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase";

const TABLE = "preloaded_models";

type Cursor = { createdAt: string; id: string };

function parsePositiveInt(v: string | null, fallback: number, min: number, max: number): number {
  const n = Number(v ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const v = JSON.parse(json) as Partial<Cursor>;
    if (!v || typeof v.createdAt !== "string" || typeof v.id !== "string") return null;
    if (!v.createdAt.trim() || !v.id.trim()) return null;
    return { createdAt: v.createdAt, id: v.id };
  } catch {
    return null;
  }
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  // Product pagination: return N *products* per page, not N raw rows.
  const pageSize = parsePositiveInt(req.nextUrl.searchParams.get("pageSize"), 5, 1, 50);
  const cursor = decodeCursor(req.nextUrl.searchParams.get("cursor"));

  try {
    const supabase = createServerSupabaseAdminClient();
    // We may need to read more raw rows than pageSize, because each product can have many variants.
    // Keep this bounded to avoid huge responses.
    const rowLimit = Math.min(Math.max(pageSize * 80, 200), 2000);

    let query = supabase
      .from(TABLE)
      .select("id,product_name,product_key,color_label,image_url,glb_url,created_at")
      .not("glb_url", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(rowLimit);

    if (q) {
      query = query.ilike("product_name", `%${q}%`);
    }

    if (cursor) {
      // created_at < cursor.createdAt OR (created_at == cursor.createdAt AND id < cursor.id)
      // Note: `or()` uses PostgREST filter syntax.
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      );
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
      product_key?: string | null;
      color_label: string | null;
      image_url: string | null;
      glb_url: string | null;
      created_at: string | null;
    }>;

    // Accumulate up to `pageSize` unique products in insertion order.
    const byProduct = new Map<
      string,
      {
        product_key: string;
        product_name: string;
        preview_image_url: string | null;
        variants: Array<{
          id: string;
          label: string;
          image_url: string | null;
        }>;
      }
    >();

    let lastIncludedRow: { created_at: string; id: string } | null = null;

    for (const row of rows) {
      const productName = String(row.product_name ?? "").trim();
      const glbUrl = String(row.glb_url ?? "").trim();
      if (!productName || !glbUrl) continue;

      const productKey =
        (typeof row.product_key === "string" ? row.product_key : null) ?? productName;
      const groupKey = productKey.trim() || productName;

      if (!byProduct.has(groupKey) && byProduct.size >= pageSize) {
        // We've collected enough products for this page.
        break;
      }

      const id = String(row.id);
      const label =
        String(row.color_label ?? "").trim() || "Variant";

      const group =
        byProduct.get(groupKey) ??
        (() => {
          const g = {
            product_key: groupKey,
            product_name: productName,
            preview_image_url: typeof row.image_url === "string" ? row.image_url : null,
            variants: [] as Array<{ id: string; label: string; image_url: string | null }>,
          };
          byProduct.set(groupKey, g);
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

      if (typeof row.created_at === "string" && row.created_at) {
        lastIncludedRow = { created_at: row.created_at, id };
      }
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
        product_key: p.product_key,
        image_url: v.image_url,
      })),
    );

    // If we hit the rowLimit, assume there may be more data. Cursor is based on the last included row.
    const nextCursor =
      lastIncludedRow && rows.length > 0 && rows.length >= rowLimit
        ? encodeCursor({ createdAt: lastIncludedRow.created_at, id: lastIncludedRow.id })
        : lastIncludedRow && rows.length > 0 && byProduct.size >= pageSize
          ? encodeCursor({ createdAt: lastIncludedRow.created_at, id: lastIncludedRow.id })
          : null;

    return NextResponse.json({ products, items, nextCursor });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

