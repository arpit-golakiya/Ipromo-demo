import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";

/** Image-edit model for PDP cleanup before 3D (Rodin, etc.). */
export const PRODUCT_CLEAN_MODEL = "gpt-5";

/**
 * Product-agnostic prompt: any promo / e-commerce item (apparel, electronics,
 * drinkware, bags, gadgets, etc.) — strip people and surface branding only.
 */
export const PRODUCT_CLEAN_PROMPT = `You are an expert product image editor for e-commerce and promotional merchandise.

TASK:
Transform the given image into a single clean product shot suitable for 3D reconstruction: the SAME physical product as in the photo, with NO people and NO printed or applied branding on the product.

IDENTIFY THE PRODUCT:
- Treat the main sellable object in the frame as "the product" (one primary item). It may be apparel, a device, a bottle, a bag, a tracker, a tool, or any other promo item — do not assume it is a shirt.

STRICT INSTRUCTIONS:
- Completely remove any human, model, face, hands, arms, or body parts from the image
- Remove ALL logos, text, slogans, brand names, graphics, stickers, labels, or prints that appear ON the product surface (including embossed or printed areas)
- Preserve the EXACT original product color, finish, and material look (matte vs glossy, metal vs plastic) — do not shift hue to make it lighter or a different color
- Preserve the product's true shape, proportions, and important physical details (buttons, holes, curves, seams) except where you must inpaint over removed branding
- Reconstruct areas where branding was removed so they match the surrounding material realistically (no blur, no smear, no fake new logos)

OUTPUT REQUIREMENTS:
- Only the product (no person, no extra props unless they were clearly part of the product in the original)
- Same general camera angle and framing as the source when reasonable
- Studio-style lighting
- Plain white or light neutral background
- High-quality catalog-style image

IMPORTANT:
- Do NOT add new logos, text, or decorative graphics anywhere
- Do NOT change the product category (do not turn a bottle into a shirt, etc.)
- Do NOT hallucinate accessories or a different product`;

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
 * Calls OpenAI Responses API with image_generation tool.
 * Returns a PNG data URI suitable for 3D APIs (e.g. Rodin). Nothing is written to disk.
 */
export async function cleanProductImageBufferToDataUrl(
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

  // SDK `Content` typings lag the Responses API; shape matches OpenAI docs.
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

  // Model returns raster base64; downstream accepts data URIs
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
