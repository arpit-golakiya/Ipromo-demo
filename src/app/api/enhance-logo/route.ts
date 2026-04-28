import OpenAI from "openai";
import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { consumeEnhanceDailyLimitIfSetOrThrow, getUserFromSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

function isDataUrl(s: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(s);
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!match) throw new Error("Invalid dataUrl");
  const mime = match[1] ?? "image/png";
  const b64 = (match[2] ?? "").replace(/\s+/g, "");
  return { buffer: Buffer.from(b64, "base64"), mime };
}

function toDataUrl(buffer: Buffer, contentType: string): string {
  const b64 = buffer.toString("base64");
  return `data:${contentType};base64,${b64}`;
}

const ENHANCE_LOGO_MODEL = "gpt-5";

const ENHANCE_LOGO_PROMPT = `You are an expert logo restoration + super-resolution service.

GOAL:
Increase the apparent resolution and clarity of this logo so it looks crisp when used as a decal/texture in a 3D viewer.

ABSOLUTE RULES (MUST FOLLOW):
- Preserve the logo IDENTICALLY: same design, geometry, layout, alignment, spacing, proportions
- Preserve ALL text exactly (no re-typing, no font substitution, no kerning changes)
- Preserve colors exactly (no hue/contrast shifts, no new gradients, no glow/shadow)
- Do not add/remove elements, do not stylize, do not "improve" the design
- If the input has transparency, keep the same transparent background (do not add a solid background)

WHAT TO IMPROVE (DO THESE):
- Remove JPEG artifacts, banding, and pixelation
- Reconstruct sharp, clean edges (vector-like where appropriate) WITHOUT changing shapes
- Increase usable resolution significantly (aim for a much larger output than input)
- Keep edges clean: no halos, no ringing, no over-sharpening, no blur

OUTPUT:
- Return exactly ONE high-quality PNG of the same logo (high resolution).`;

function pickGeneratedImageBase64(response: JsonValue): string | null {
  // Matches the pattern used in Ipromo-demo-frontend: Responses API output includes
  // items of type "image_generation_call" with a base64 PNG in `result`.
  if (!response || typeof response !== "object") return null;
  const obj = response as Record<string, JsonValue>;
  const output = obj.output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, JsonValue>;
    if (it.type === "image_generation_call" && typeof it.result === "string" && it.result.trim()) {
      return it.result.replace(/\s+/g, "");
    }
  }
  return null;
}

async function saveEnhancedPngLocally(pngBase64: string): Promise<{ absPath: string; publicUrl: string }> {
  const safeB64 = pngBase64.replace(/\s+/g, "");
  const buffer = Buffer.from(safeB64, "base64");
  if (buffer.length < 50) throw new Error("Invalid PNG payload");

  const dir = path.join(process.cwd(), "public", "enhanced-logos");
  await mkdir(dir, { recursive: true });

  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const filename = `enhanced-${new Date().toISOString().replace(/[:.]/g, "-")}-${id}.png`;
  const absPath = path.join(dir, filename);
  await writeFile(absPath, buffer);

  return { absPath, publicUrl: `/enhanced-logos/${encodeURIComponent(filename)}` };
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing server env: OPENAI_API_KEY" },
      { status: 500 },
    );
  }

  // Require auth (and enforce per-user daily limit if set) before doing any OpenAI work.
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ipromo_session")?.value ?? "";
    const user = token ? await getUserFromSessionToken(token) : null;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Unlimited by default. If `users.enhance_daily_limit` is set (non-null), it enforces per UTC day.
    if (!user.isAdmin) {
      const quota = await consumeEnhanceDailyLimitIfSetOrThrow(user.id);
      (req as unknown as { __ipromo_enhance_remaining_today__?: number | null })
        .__ipromo_enhance_remaining_today__ = quota.remainingToday;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    if (/enhance limit reached/i.test(msg)) {
      return NextResponse.json({ error: "Enhance limit reached" }, { status: 429 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Accept either:
  // - multipart/form-data with field "image" (File)
  // - application/json { dataUrl: "data:image/..;base64,..." }
  let imageBytes: Buffer | null = null;
  let imageMime = "image/png";

  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }
    const image = form.get("image");
    if (!(image instanceof File)) {
      return NextResponse.json({ error: "Missing form field: image" }, { status: 400 });
    }
    imageMime = (image.type || "image/png").split(";")[0] || "image/png";
    imageBytes = Buffer.from(await image.arrayBuffer());
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Expected JSON body or multipart/form-data" }, { status: 400 });
    }
    const dataUrl = (body as { dataUrl?: unknown } | null)?.dataUrl;
    if (typeof dataUrl !== "string" || !isDataUrl(dataUrl)) {
      return NextResponse.json({ error: "Missing/invalid field: dataUrl" }, { status: 400 });
    }
    try {
      const parsed = dataUrlToBuffer(dataUrl);
      imageBytes = parsed.buffer;
      imageMime = parsed.mime;
    } catch {
      return NextResponse.json({ error: "Invalid dataUrl" }, { status: 400 });
    }
  }

  if (!imageBytes || imageBytes.length < 50) {
    return NextResponse.json({ error: "Invalid image payload" }, { status: 400 });
  }

  // Responses API + image_generation (mirrors Ipromo-demo-frontend approach).
  const openai = new OpenAI({ apiKey, timeout: 300_000, maxRetries: 1 });

  try {
    const inputDataUrl = toDataUrl(imageBytes, imageMime);

    const raw = await openai.responses.create({
      model: ENHANCE_LOGO_MODEL,
      tools: [{ type: "image_generation" }],
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: inputDataUrl },
            { type: "input_text", text: ENHANCE_LOGO_PROMPT },
          ],
        },
      ],
    } as Parameters<typeof openai.responses.create>[0]);

    const b64 = pickGeneratedImageBase64(raw as unknown as JsonValue);
    if (!b64) {
      return NextResponse.json(
        { error: "OpenAI did not return a generated image" },
        { status: 502 },
      );
    }

    // Guardrail: prevent returning extremely large payloads (can crash clients / exceed limits).
    if (b64.length > 20_000_000) {
      return NextResponse.json({ error: "Enhanced image too large to return" }, { status: 502 });
    }

    // Store locally (dev convenience). On serverless platforms, disk may be ephemeral.
    let saved: { absPath: string; publicUrl: string } | null = null;
    try {
      saved = await saveEnhancedPngLocally(b64);
    } catch {
      saved = null;
    }

    const enhanceRemainingToday =
      (req as unknown as { __ipromo_enhance_remaining_today__?: number | null })
        .__ipromo_enhance_remaining_today__;

    return NextResponse.json({
      dataUrl: `data:image/png;base64,${b64}`,
      ...(saved ? { savedPath: saved.absPath, publicUrl: saved.publicUrl } : {}),
      ...(typeof enhanceRemainingToday === "number" ? { enhanceRemainingToday } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}