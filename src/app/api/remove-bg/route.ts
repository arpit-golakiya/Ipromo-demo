import OpenAI from "openai";
import { NextResponse } from "next/server";
import { toFile } from "openai/uploads";
import sharp from "sharp";

export const runtime = "nodejs";

const REMOVE_BG_MODEL = "gpt-image-1";

const REMOVE_BG_PROMPT = `
Task: Remove the background and return a PNG with a transparent background.

Hard constraints (must-follow):
- Keep the entire original image content. NEVER crop/trim anything from any side.
- Output MUST keep the exact same pixel width and height as the input (same canvas size).
- Do NOT zoom, reframe, rotate, flip, resize, stretch, or change aspect ratio.
- The subject may extend to image edges. DO NOT crop or reframe even if it touches borders.
- Do NOT redraw or “improve” the subject. Preserve all details (logos/text/edges) and overall colors.
- Background must be true alpha transparency (alpha=0), not white/black/checkerboard.

Segmentation rules:
- Only remove the surrounding background behind the subject(s).
- Keep all subject pixels, including thin edges, holes, translucent parts, and small details.
- When uncertain, KEEP the pixel (prefer leaving background over cutting subject).
- IMPORTANT for logos: Do NOT remove internal white fills. Only background pixels connected to the OUTER border should be transparent.

Edge rules:
- Clean edges with minimal halo/fringe; avoid aggressive feathering.

Fail-safe:
- If you cannot do this without changing framing/canvas size, return the original image unchanged.
`;

function keepOnlyBorderConnectedTransparency(params: {
  originalRgba: Buffer;
  editedRgba: Buffer;
  width: number;
  height: number;
}): Buffer {
  const { originalRgba, editedRgba, width, height } = params;
  const total = width * height;
  const out = Buffer.from(editedRgba);

  // Find transparent pixels connected to image border (4-neighborhood flood fill).
  const visited = new Uint8Array(total);
  const keepTransparent = new Uint8Array(total);
  const queue = new Uint32Array(total);
  let qh = 0;
  let qt = 0;

  const idx = (x: number, y: number) => y * width + x;
  const isTransparent = (i: number) => out[i * 4 + 3] === 0;

  const pushIf = (i: number) => {
    if (visited[i]) return;
    visited[i] = 1;
    if (!isTransparent(i)) return;
    keepTransparent[i] = 1;
    queue[qt++] = i;
  };

  // Seed from all border pixels that are transparent.
  for (let x = 0; x < width; x++) {
    pushIf(idx(x, 0));
    pushIf(idx(x, height - 1));
  }
  for (let y = 1; y < height - 1; y++) {
    pushIf(idx(0, y));
    pushIf(idx(width - 1, y));
  }

  while (qh < qt) {
    const i = queue[qh++];
    const x = i % width;
    const y = (i - x) / width;

    if (x > 0) pushIf(i - 1);
    if (x + 1 < width) pushIf(i + 1);
    if (y > 0) pushIf(i - width);
    if (y + 1 < height) pushIf(i + width);
  }

  // Any transparent pixel NOT connected to the border is treated as an accidental "hole" and restored.
  for (let i = 0; i < total; i++) {
    const a = out[i * 4 + 3];
    if (a !== 0) continue;
    if (keepTransparent[i]) continue;

    out[i * 4 + 0] = originalRgba[i * 4 + 0];
    out[i * 4 + 1] = originalRgba[i * 4 + 1];
    out[i * 4 + 2] = originalRgba[i * 4 + 2];
    out[i * 4 + 3] = originalRgba[i * 4 + 3] || 255;
  }

  return out;
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing server env: OPENAI_API_KEY" }, { status: 500 });
  }

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

  let imageBytes: Buffer;
  try {
    imageBytes = Buffer.from(await image.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Invalid image payload" }, { status: 400 });
  }

  if (imageBytes.length < 50) {
    return NextResponse.json({ error: "Invalid image payload" }, { status: 400 });
  }

  const imageMime = (image.type || "image/png").split(";")[0] || "image/png";
  const openai = new OpenAI({ apiKey, timeout: 300_000, maxRetries: 1 });

  try {
    const meta = await sharp(imageBytes).metadata();
    const origWidth = meta.width || 1024;
    const origHeight = meta.height || 1024;

    // 🧠 Step 2: Pad image to square (prevents cropping)
    const padded = await sharp(imageBytes)
      .ensureAlpha()
      .resize({
        width: 1024,
        height: 1024,
        fit: "contain", // critical
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const inputFile = await toFile(padded, image.name || "image.png", {
      type: "image/png",
    });

    // 🧠 Step 3: OpenAI background removal
    const res = await openai.images.edit({
      model: REMOVE_BG_MODEL,
      image: inputFile,
      prompt: REMOVE_BG_PROMPT,
      background: "transparent",
      output_format: "png",
      quality: "high",
      size: "1024x1024",
      input_fidelity: "high",
    });


    const b64 = res.data?.[0]?.b64_json?.replace(/\s+/g, "");
    if (!b64) return NextResponse.json({ error: "OpenAI did not return an image" }, { status: 502 });

    // Guardrail: prevent returning extremely large payloads (can crash clients / exceed limits).
    if (b64.length > 20_000_000) {
      return NextResponse.json({ error: "Image too large to return" }, { status: 502 });
    }

    // Post-process: keep only border-connected transparency to prevent logos losing internal white fills.
    let outB64 = b64;
    try {
      const editedPng = Buffer.from(b64, "base64");
      const [origRaw, editedRaw] = await Promise.all([
        sharp(imageBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
        sharp(editedPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      ]);

      if (
        origRaw.info.width === editedRaw.info.width &&
        origRaw.info.height === editedRaw.info.height &&
        origRaw.info.channels === 4 &&
        editedRaw.info.channels === 4
      ) {
        const fixedRaw = keepOnlyBorderConnectedTransparency({
          originalRgba: origRaw.data,
          editedRgba: editedRaw.data,
          width: editedRaw.info.width,
          height: editedRaw.info.height,
        });

        const fixedPng = await sharp(fixedRaw, {
          raw: { width: editedRaw.info.width, height: editedRaw.info.height, channels: 4 },
        })
          .png()
          .toBuffer();

        outB64 = fixedPng.toString("base64");
      }
    } catch {
      // If post-processing fails for any reason, fall back to the model output.
    }

    return NextResponse.json({ dataUrl: `data:image/png;base64,${outB64}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}