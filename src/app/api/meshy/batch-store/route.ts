import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase";
import { getMeshyTaskStatus } from "@/lib/meshy";

const TABLE = "preloaded_models";

type StoreItem = {
  key: string;
  colorLabel?: string;
  colorHex?: string;
  imageUrl: string;
  taskId: string;
  modelUrl?: string | null;
};

function normalizeProductUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    return u.toString();
  } catch {
    return raw.trim();
  }
}

export async function POST(req: NextRequest) {
  let body: { productUrl?: string; items?: StoreItem[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const productUrl = typeof body.productUrl === "string" ? body.productUrl.trim() : "";
  if (!productUrl) {
    return NextResponse.json({ error: "Missing productUrl in request body" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items.filter((i) => i.taskId && i.imageUrl) : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "No successful items to store" }, { status: 400 });
  }

  const normalizedProductUrl = normalizeProductUrl(productUrl);

  try {
    const supabase = createServerSupabaseAdminClient();
    const rows = await Promise.all(
      items.slice(0, 40).map(async (item) => {
        let glbUrl: string | null = item.modelUrl ?? null;
        if (!glbUrl) {
          try {
            const status = await getMeshyTaskStatus(item.taskId);
            glbUrl = status.modelUrl;
          } catch {
            // Keep null if Meshy status lookup fails for this item.
          }
        }
        return {
          product_url: normalizedProductUrl,
          color_key: item.key,
          color_label: item.colorLabel ?? null,
          color_hex: item.colorHex ?? null,
          image_url: item.imageUrl,
          task_id: item.taskId,
          glb_url: glbUrl,
        };
      }),
    );

    const { error } = await supabase.from(TABLE).upsert(rows, {
      onConflict: "product_url,color_key",
    });
    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to store preloaded models" },
        { status: 502 },
      );
    }

    return NextResponse.json({ stored: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

