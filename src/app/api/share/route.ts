import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase";
import type { DecalConfig } from "@/types/configurator";

type SharePayload = {
  v: 1;
  productName: string;
  color: string;
  decal: DecalConfig;
  /** Optional Meshy task id so the shared link can restore generated model. */
  taskId: string | null;
  /** Logo image stored as a data URL (we may later migrate this to Supabase Storage). */
  logoDataUrl: string | null;
  /** PDP color variants — kept server-side so short /s/:id links restore all swatches. */
  scrapedColors?: Array<{ label: string; hex: string }>;
};

const HEX6 = /^#[0-9A-Fa-f]{6}$/;

function sanitizeScrapedColors(
  raw: unknown,
): Array<{ label: string; hex: string }> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<{ label: string; hex: string }> = [];
  for (const item of raw.slice(0, 80)) {
    if (!item || typeof item !== "object") continue;
    const o = item as { label?: unknown; hex?: unknown };
    const label =
      typeof o.label === "string" ? o.label.slice(0, 120).trim() : "";
    let hex = typeof o.hex === "string" ? o.hex.trim() : "";
    if (!hex.startsWith("#")) hex = `#${hex}`;
    if (!HEX6.test(hex)) continue;
    out.push({ label: label || hex, hex });
  }
  return out.length > 0 ? out : undefined;
}

const TABLE = "shared_configs";

export async function POST(req: NextRequest) {
  let payload: SharePayload;
  try {
    payload = (await req.json()) as SharePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload || payload.v !== 1) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const cleanedColors = sanitizeScrapedColors(payload.scrapedColors);
  const payloadToStore: SharePayload = {
    ...payload,
    ...(cleanedColors ? { scrapedColors: cleanedColors } : {}),
  };
  if (!cleanedColors) delete payloadToStore.scrapedColors;

  try {
    const supabase = createServerSupabaseAdminClient();
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        payload: payloadToStore,
        logo_url: null,
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to create share link" },
        { status: 502 },
      );
    }

    return NextResponse.json({ id: data.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing ?id=" }, { status: 400 });
  }

  try {
    const supabase = createServerSupabaseAdminClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("payload, logo_url")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

