import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import type { DecalConfig } from "@/types/configurator";

const TABLE = "preloaded_models";

function parseModelId(raw: string | null): string | null {
  if (raw == null || raw === "") return null;
  const id = raw.trim();
  if (id.length < 1 || id.length > 200) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  return id;
}

function parseColorLabel(raw: string | null): string | null {
  if (raw == null) return null;
  const s = raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (s.length > 140) return s.slice(0, 140).trim();
  return s;
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
  const colorLabel = parseColorLabel(req.nextUrl.searchParams.get("colorLabel"));

  if (!modelId && !productKey) {
    return NextResponse.json(
      { error: "Missing ?modelId= or ?productKey=" },
      { status: 400 },
    );
  }

  try {
    // If only modelId is provided, derive productKey from the model row.
    let effectiveProductKey = productKey;
    if (!effectiveProductKey && modelId) {
      const { rows } = await dbQuery<{ product_key: string | null }>(
        `select product_key from ${TABLE} where id::text = $1 limit 1`,
        [modelId],
      );
      const pk = String(rows[0]?.product_key ?? "").trim();
      if (pk) effectiveProductKey = pk;
    }

    if (!effectiveProductKey) {
      return NextResponse.json({
        modelId: modelId ?? null,
        productKey: productKey ?? null,
        decal: null,
      });
    }

    // Prefer a color-specific preset when available; fallback to product-level.
    const rows =
      colorLabel
        ? (
            await dbQuery<{ default_decal: unknown | null }>(
              `select default_decal
               from ${TABLE}
               where product_key = $1
                 and default_decal is not null
                 and lower(trim(coalesce(color_label, ''))) = lower(trim($2))
               limit 1`,
              [effectiveProductKey, colorLabel],
            )
          ).rows
        : [];

    const fallbackRows =
      rows.length > 0
        ? rows
        : (
            await dbQuery<{ default_decal: unknown | null }>(
              `select default_decal
               from ${TABLE}
               where product_key = $1 and default_decal is not null
               limit 1`,
              [effectiveProductKey],
            )
          ).rows;

    const decal = fallbackRows[0]?.default_decal ?? null;
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
  let body: { modelId?: string; productKey?: string; colorLabel?: string; decal?: unknown };
  try {
    body = (await req.json()) as {
      modelId?: string;
      productKey?: string;
      colorLabel?: string;
      decal?: unknown;
    };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const modelId = parseModelId(body?.modelId ?? null);
  const productKeyRaw = String(body?.productKey ?? "").trim();
  const productKey = productKeyRaw.length > 0 && productKeyRaw.length <= 200 ? productKeyRaw : null;
  const colorLabel = parseColorLabel(body?.colorLabel ?? null);

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
    let effectiveProductKey = productKey;
    if (!effectiveProductKey && modelId) {
      const { rows } = await dbQuery<{ product_key: string | null }>(
        `select product_key from ${TABLE} where id::text = $1 limit 1`,
        [modelId],
      );
      const pk = String(rows[0]?.product_key ?? "").trim();
      if (pk) effectiveProductKey = pk;
    }

    if (!effectiveProductKey) {
      return NextResponse.json(
        { ok: false, error: "Could not resolve product key for saving preset" },
        { status: 400 },
      );
    }

    // If a colorLabel is provided, save only for that variant; otherwise, save at product level.
    if (colorLabel) {
      await dbQuery(
        `update ${TABLE}
         set default_decal = $1::jsonb
         where product_key = $2
           and lower(trim(coalesce(color_label, ''))) = lower(trim($3))`,
        [JSON.stringify(body.decal), effectiveProductKey, colorLabel],
      );
    } else {
      // Update all variants for the product so any row can provide the preset later.
      await dbQuery(
        `update ${TABLE} set default_decal = $1::jsonb where product_key = $2`,
        [JSON.stringify(body.decal), effectiveProductKey],
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

