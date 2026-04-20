import OpenAI from "openai";
import { NextResponse } from "next/server";

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

const ENHANCE_LOGO_PROMPT = `You are an expert logo upscaling and enhancement service.

TASK:
Improve the quality of the given logo image while preserving the original EXACTLY.

STRICT REQUIREMENTS (DO NOT VIOLATE):
- Do NOT change the logo design, shapes, layout, alignment, spacing, or proportions
- Do NOT change any text content, letterforms, kerning, or font appearance
- Do NOT change colors (no hue shift), contrast, or add effects
- Do NOT add or remove any elements
- Preserve transparency exactly if present

OUTPUT:
- Return a single high-quality PNG 4K resolution`;

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

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing server env: OPENAI_API_KEY" },
      { status: 500 },
    );
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

    return NextResponse.json({ dataUrl: `data:image/png;base64,${b64}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

