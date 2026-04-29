import { NextResponse } from "next/server";
import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { getBrandForUser, requireAuthedUser, updateBrandForUser, deleteBrandForUser } from "@/lib/brands";
import { generateBrandVariants } from "@/lib/brandVariants";

export const runtime = "nodejs";

async function savePngBufferLocally(buffer: Buffer, prefix: string): Promise<string> {
  if (buffer.length < 50) throw new Error("Invalid PNG payload");
  const dir = path.join(process.cwd(), "public", "brand-variants");
  await mkdir(dir, { recursive: true });
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const filename = `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${id}.png`;
  await writeFile(path.join(dir, filename), buffer);
  return `/brand-variants/${encodeURIComponent(filename)}`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const awaited = await params;
  const id = (awaited?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Missing brand id" }, { status: 400 });

  try {
    const user = await requireAuthedUser();
    const brand = await getBrandForUser({ ownerId: user.id, brandId: id });
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    return NextResponse.json({ brand }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch brand";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const awaited = await params;
  const id = (awaited?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Missing brand id" }, { status: 400 });

  try {
    const user = await requireAuthedUser();
    const ok = await deleteBrandForUser({ ownerId: user.id, brandId: id });
    if (!ok) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete brand";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const awaited = await params;
  const id = (awaited?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Missing brand id" }, { status: 400 });

  let userId = "";
  try {
    const user = await requireAuthedUser();
    userId = user.id;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const rawName = form.get("name");
    const image = form.get("image");
    const name = typeof rawName === "string" ? rawName.trim() : undefined;

    if (!(image instanceof File)) {
      return NextResponse.json({ error: "Missing form field: image" }, { status: 400 });
    }

    const mime = (image.type || "image/png").split(";")[0] || "image/png";
    if (!mime.startsWith("image/")) return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
    const imageBytes = Buffer.from(await image.arrayBuffer());
    if (imageBytes.length < 50) return NextResponse.json({ error: "Invalid image payload" }, { status: 400 });

    let variantBuffers: Buffer[];
    try {
      variantBuffers = await generateBrandVariants(imageBytes);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Variant generation failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    let publicUrls: string[];
    try {
      publicUrls = await Promise.all(variantBuffers.map((buf, idx) => savePngBufferLocally(buf, `brand-v${idx + 1}`)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save variants";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const updated = await updateBrandForUser({
      ownerId: userId,
      brandId: id,
      name,
      imageUrl: publicUrls[0],
      logoVariants: publicUrls,
    });
    if (!updated) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    return NextResponse.json({ brand: updated, variants: publicUrls }, { status: 200 });
  }

  // JSON: allow name/isApproved/logoVariants update.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }
  const name = (body as { name?: unknown } | null)?.name;
  const isApproved = (body as { isApproved?: unknown } | null)?.isApproved;
  const logoVariants = (body as { logoVariants?: unknown } | null)?.logoVariants;
  if (name !== undefined && typeof name !== "string") {
    return NextResponse.json({ error: "Invalid field: name" }, { status: 400 });
  }
  if (isApproved !== undefined && typeof isApproved !== "boolean") {
    return NextResponse.json({ error: "Invalid field: isApproved" }, { status: 400 });
  }
  if (logoVariants !== undefined && (!Array.isArray(logoVariants) || !logoVariants.every((x) => typeof x === "string"))) {
    return NextResponse.json({ error: "Invalid field: logoVariants" }, { status: 400 });
  }
  const updated = await updateBrandForUser({
    ownerId: userId,
    brandId: id,
    name: typeof name === "string" ? name : undefined,
    isApproved: typeof isApproved === "boolean" ? isApproved : undefined,
    logoVariants: Array.isArray(logoVariants) ? (logoVariants as string[]) : undefined,
  });
  if (!updated) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  return NextResponse.json({ brand: updated, variants: updated.logoVariants }, { status: 200 });
}
