import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const TABLE = "preloaded_models";

function parseS3Uri(raw: string): { bucket: string; key: string } | null {
  const s = raw.trim();
  if (!s.toLowerCase().startsWith("s3://")) return null;
  const rest = s.slice("s3://".length);
  const slash = rest.indexOf("/");
  if (slash < 1) return null;
  const bucket = rest.slice(0, slash).trim();
  const key = rest.slice(slash + 1).trim();
  if (!bucket || !key) return null;
  return { bucket, key };
}

async function toFetchUrl(glbUrlOrS3: string): Promise<string> {
  const parsed = parseS3Uri(glbUrlOrS3);
  if (!parsed) return glbUrlOrS3;

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new Error("Missing server env: AWS_REGION");
  }

  const client = new S3Client({ region });
  const cmd = new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key });
  return await getSignedUrl(client, cmd, { expiresIn: 60 * 30 }); // 30 min
}

export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "Missing ?id=" }, { status: 400 });
  }

  try {
    const supabase = createServerSupabaseAdminClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("glb_url")
      .eq("id", id)
      .single();

    if (error || !data?.glb_url) {
      return NextResponse.json({ error: error?.message ?? "Model not found" }, { status: 404 });
    }

    const glbUrl = String(data.glb_url);
    const fetchUrl = await toFetchUrl(glbUrl);
    const modelRes = await fetch(fetchUrl);
    if (!modelRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch model: HTTP ${modelRes.status}` },
        { status: 502 },
      );
    }

    const buffer = await modelRes.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=600",
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

