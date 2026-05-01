import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import type { DecalConfig, LogoLayer } from "@/types/configurator";

type SharePayloadV1 = {
  v: 1;
  productName: string;
  color: string;
  decal: DecalConfig;
  /** Selected preloaded model id (from the library). */
  modelId: string | null;
  /** Logo image stored as a data URL (we may later migrate this to Supabase Storage). */
  logoDataUrl: string | null;
};

type SharePayloadV2 = {
  v: 2;
  productName: string;
  color: string;
  /** Selected preloaded model id (from the library). */
  modelId: string | null;
  /** Up to 4 logos, each with its own placement + decal config. */
  logos: LogoLayer[];
};

type SharePayload = SharePayloadV1 | SharePayloadV2;

const TABLE = "shared_configs";

export async function POST(req: NextRequest) {
  let payload: SharePayload;
  try {
    payload = (await req.json()) as SharePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const v = (payload as { v?: unknown } | null)?.v;
  if (!payload || (v !== 1 && v !== 2)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const payloadToStore: SharePayload = payload;

  try {
    const { rows } = await dbQuery<{ id: string | number }>(
      `insert into ${TABLE} (payload, logo_url) values ($1::jsonb, $2) returning id`,
      [JSON.stringify(payloadToStore), null],
    );

    const id = rows[0]?.id;
    if (id == null) {
      return NextResponse.json(
        { error: "Failed to create share link" },
        { status: 502 },
      );
    }

    return NextResponse.json({ id });
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
    const { rows } = await dbQuery<{ payload: unknown; logo_url: string | null }>(
      `select payload, logo_url from ${TABLE} where id::text = $1 limit 1`,
      [id],
    );
    const data = rows[0] ?? null;

    if (!data) {
      return NextResponse.json(
        { error: "Not found" },
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

