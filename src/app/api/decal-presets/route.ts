import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase";
import type { DecalConfig } from "@/types/configurator";

const TABLE = "preloaded_models";

function parseModelId(raw: string | null): string | null {
  if (raw == null || raw === "") return null;
  const id = raw.trim();
  if (id.length < 1 || id.length > 200) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  return id;
}

function isDecalConfig(v: unknown): v is DecalConfig {
  if (!v || typeof v !== "object") return false;
  const o = v as { position?: unknown; rotation?: unknown; scale?: unknown };
  const pos = o.position as unknown;
  const rot = o.rotation as unknown;
  const scale = o.scale as unknown;
  const isVec3 = (x: unknown) =>
    Array.isArray(x) &&
    x.length === 3 &&
    x.every((n) => typeof n === "number" && Number.isFinite(n));
  return isVec3(pos) && isVec3(rot) && typeof scale === "number" && Number.isFinite(scale);
}

export async function GET(req: NextRequest) {
  const modelId = parseModelId(req.nextUrl.searchParams.get("modelId"));
  const productKeyRaw = (req.nextUrl.searchParams.get("productKey") ?? "").trim();
  const productKey = productKeyRaw.length > 0 && productKeyRaw.length <= 200 ? productKeyRaw : null;

  if (!modelId && !productKey) {
    return NextResponse.json(
      { error: "Missing ?modelId= or ?productKey=" },
      { status: 400 },
    );
  }

  try {
    const supabase = createServerSupabaseAdminClient();
    // If only modelId is provided, derive productKey from the model row.
    let effectiveProductKey = productKey;
    if (!effectiveProductKey && modelId) {
      const { data, error } = await supabase
        .from(TABLE)
        .select("product_key")
        .eq("id", modelId)
        .maybeSingle();

      if (error) {
        return NextResponse.json(
          { error: error.message ?? "Failed to resolve product key" },
          { status: 502 },
        );
      }

      if (data && typeof (data as { product_key?: unknown }).product_key === "string") {
        const pk = String((data as { product_key?: string }).product_key ?? "").trim();
        if (pk) effectiveProductKey = pk;
      }
    }

    if (!effectiveProductKey) {
      return NextResponse.json({
        modelId: modelId ?? null,
        productKey: productKey ?? null,
        decal: null,
      });
    }

    const { data, error } = await supabase
      .from(TABLE)
      .select("default_decal")
      .eq("product_key", effectiveProductKey)
      .not("default_decal", "is", null)
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to fetch decal preset" },
        { status: 502 },
      );
    }

    const decal = (data as { default_decal?: unknown } | null)?.default_decal;
    return NextResponse.json({
      modelId: modelId ?? null,
      productKey: effectiveProductKey,
      decal: isDecalConfig(decal) ? decal : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { modelId?: string; productKey?: string; decal?: unknown };
  try {
    body = (await req.json()) as { modelId?: string; productKey?: string; decal?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const modelId = parseModelId(body?.modelId ?? null);
  const productKeyRaw = String(body?.productKey ?? "").trim();
  const productKey = productKeyRaw.length > 0 && productKeyRaw.length <= 200 ? productKeyRaw : null;

  if (!modelId && !productKey) {
    return NextResponse.json(
      { ok: false, error: "Missing modelId or productKey" },
      { status: 400 },
    );
  }
  if (!isDecalConfig(body?.decal)) {
    return NextResponse.json({ ok: false, error: "Missing or invalid decal" }, { status: 400 });
  }

  try {
    const supabase = createServerSupabaseAdminClient();
    let effectiveProductKey = productKey;
    if (!effectiveProductKey && modelId) {
      const { data, error } = await supabase
        .from(TABLE)
        .select("product_key")
        .eq("id", modelId)
        .maybeSingle();
      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message ?? "Failed to resolve product key" },
          { status: 502 },
        );
      }
      const pk = String((data as { product_key?: unknown } | null)?.product_key ?? "").trim();
      if (pk) effectiveProductKey = pk;
    }

    if (!effectiveProductKey) {
      return NextResponse.json(
        { ok: false, error: "Could not resolve product key for saving preset" },
        { status: 400 },
      );
    }

    // Update all variants for the product so any row can provide the preset later.
    const { error } = await supabase
      .from(TABLE)
      .update({ default_decal: body.decal })
      .eq("product_key", effectiveProductKey);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message ?? "Failed to save decal preset" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

