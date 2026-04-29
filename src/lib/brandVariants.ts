import sharp from "sharp";

type Rgb = [number, number, number];

/**
 * Flood-fill background removal starting from the 4 image borders.
 * Detects background color by averaging the 4 corner pixels, then
 * makes any border-reachable pixel within `threshold` color distance
 * fully transparent. Leaves interior logo pixels untouched.
 */
async function stripBackground(input: Buffer, threshold = 36): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info; // channels = 4

  const px = (x: number, y: number) => (y * width + x) * channels;

  // Average the 4 corners to determine the background color.
  const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]] as const;
  let bgR = 0, bgG = 0, bgB = 0;
  for (const [cx, cy] of corners) {
    const i = px(cx, cy);
    bgR += data[i] ?? 255;
    bgG += data[i + 1] ?? 255;
    bgB += data[i + 2] ?? 255;
  }
  bgR = Math.round(bgR / 4);
  bgG = Math.round(bgG / 4);
  bgB = Math.round(bgB / 4);

  const dist = (r: number, g: number, b: number) => {
    const dr = r - bgR, dg = g - bgG, db = b - bgB;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  const visited = new Uint8Array(width * height);
  // Use a plain array as queue; qi is the read cursor.
  const queue: number[] = [];

  const seed = (x: number, y: number) => {
    const vi = y * width + x;
    if (!visited[vi]) {
      visited[vi] = 1;
      queue.push(vi);
    }
  };

  // Seed all border pixels.
  for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { seed(0, y); seed(width - 1, y); }

  const out = Buffer.from(data);
  let qi = 0;

  while (qi < queue.length) {
    const vi = queue[qi++]!;
    const x = vi % width;
    const y = Math.floor(vi / width);
    const pi = vi * channels;

    const a = data[pi + 3] ?? 0;
    const r = data[pi] ?? 0;
    const g = data[pi + 1] ?? 0;
    const b = data[pi + 2] ?? 0;

    // Only erase if: already transparent OR close to bg color.
    if (a < 18 || dist(r, g, b) <= threshold) {
      out[pi + 3] = 0; // erase

      if (x > 0) seed(x - 1, y);
      if (x < width - 1) seed(x + 1, y);
      if (y > 0) seed(x, y - 1);
      if (y < height - 1) seed(x, y + 1);
    }
  }

  return sharp(out, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Measure average perceived brightness (0–255) of all non-transparent pixels.
 */
async function avgBrightness(input: Buffer): Promise<number> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { channels } = info;
  let total = 0, count = 0;
  for (let i = 0; i < data.length; i += channels) {
    const a = data[i + 3] ?? 0;
    if (a < 18) continue;
    total += 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
    count++;
  }
  return count === 0 ? 128 : total / count;
}

/**
 * Replace every non-transparent pixel's RGB with the given solid color,
 * preserving the alpha channel exactly.
 */
async function recolorToSolid(input: Buffer, color: Rgb): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const out = Buffer.from(data);

  for (let i = 0; i < out.length; i += channels) {
    if ((out[i + 3] ?? 0) < 4) continue;
    out[i] = color[0];
    out[i + 1] = color[1];
    out[i + 2] = color[2];
  }

  return sharp(out, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function generateBrandVariants(imageBytes: Buffer): Promise<Buffer[]> {
  // Step 1: strip any baked-in background from the uploaded image.
  const transparent = await stripBackground(imageBytes);

  // Variant #1: original colors, transparent bg
  const v1 = await sharp(transparent).png({ compressionLevel: 9 }).toBuffer();

  // Variant #2: white logo, transparent bg
  const v2 = await recolorToSolid(transparent, [255, 255, 255]);

  // Variant #3: auto-contrast — black if logo is mostly light, white if mostly dark
  const brightness = await avgBrightness(transparent);
  const contrastColor: Rgb = brightness > 127 ? [0, 0, 0] : [255, 255, 255];
  const v3 = await recolorToSolid(transparent, contrastColor);

  // Variant #4: black logo, transparent bg
  const v4 = await recolorToSolid(transparent, [0, 0, 0]);

  return [v1, v2, v3, v4];
}
