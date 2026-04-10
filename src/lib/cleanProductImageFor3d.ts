import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";

/** Same model as `test.py` */
export const PRODUCT_CLEAN_MODEL = "gpt-5";

/**
 * Same instructions as `test.py` (logo / model removal for e-commerce shirt photo).
 */
export const PRODUCT_CLEAN_PROMPT = `You are an expert product image editor.

TASK:
Transform the given image into a professional e-commerce product photo of ONLY the t-shirt.

STRICT INSTRUCTIONS:
- Completely remove any human, model, face, arms, or body parts
- Remove ALL logos, text, branding, graphics, or prints from the t-shirt
- Preserve the EXACT original t-shirt color (do not change color)
- Preserve fabric texture and natural folds as much as possible
- Reconstruct missing areas realistically (no blur, no artifacts)

OUTPUT REQUIREMENTS:
- Only a plain t-shirt (no person)
- Centered, front-facing
- Clean, symmetrical shape
- Studio lighting
- Plain white or light neutral background
- High-quality e-commerce style image

IMPORTANT:
- Do NOT add new logos or designs
- Do NOT change t-shirt type
- Do NOT hallucinate extra elements`;

function mediaTypeForImage(buffer: Buffer, contentType: string, sourceUrl: string): string {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("image/jpeg") || ct === "image/jpg") return "image/jpeg";
  if (ct.startsWith("image/png")) return "image/png";
  if (ct.startsWith("image/webp")) return "image/webp";
  if (ct.startsWith("image/gif")) return "image/gif";

  const lower = sourceUrl.split("?")[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";

  // PNG is a safe default for unknown raster types
  const isProbablyPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  return isProbablyPng ? "image/png" : "image/jpeg";
}

function pickGeneratedImageBase64(response: Response): string | null {
  for (const item of response.output ?? []) {
    if (item.type === "image_generation_call" && item.result) {
      return item.result;
    }
  }
  return null;
}

/**
 * Calls OpenAI Responses API with image_generation tool (same behavior as test.py).
 * Returns a Meshy-ready data URI (PNG/JPEG base64). Nothing is written to disk.
 */
export async function cleanProductImageBufferToMeshyDataUrl(
  buffer: Buffer,
  contentType: string,
  sourceUrlForHints: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const mediaType = mediaTypeForImage(buffer, contentType, sourceUrlForHints);
  const imageB64 = buffer.toString("base64");

  const client = new OpenAI({
    apiKey,
    timeout: 300_000,
    maxRetries: 1,
  });

  // SDK `Content` typings lag the Responses API; shape matches `test.py` / OpenAI docs.
  const raw = await client.responses.create({
    model: PRODUCT_CLEAN_MODEL,
    tools: [{ type: "image_generation" }],
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: `data:${mediaType};base64,${imageB64}`,
          },
          {
            type: "input_text",
            text: PRODUCT_CLEAN_PROMPT,
          },
        ],
      },
    ],
  } as Parameters<typeof client.responses.create>[0]);

  const response = raw as Response;

  const imageData = pickGeneratedImageBase64(response);
  if (!imageData) {
    throw new Error("OpenAI did not return a generated image");
  }

  // Model returns raster base64; Meshy accepts data URIs
  return `data:image/png;base64,${imageData}`;
}

export async function loadImageBufferFromUrl(
  imageUrl: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (imageUrl.startsWith("data:")) {
    const comma = imageUrl.indexOf(",");
    if (comma < 0) throw new Error("Invalid data URL");
    const header = imageUrl.slice(5, comma);
    const dataPart = imageUrl.slice(comma + 1);
    const semi = header.indexOf(";");
    const mime = semi >= 0 ? header.slice(0, semi) : header;
    const isBase64 = header.toLowerCase().includes("base64");
    const buffer = isBase64
      ? Buffer.from(dataPart, "base64")
      : Buffer.from(decodeURIComponent(dataPart), "utf8");
    return { buffer, contentType: mime || "image/png" };
  }

  const res = await fetch(imageUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to download image (${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType =
    res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  return { buffer, contentType };
}
