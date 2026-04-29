import { NextResponse } from "next/server";
import { createBrandForUser, listBrandsForUser, requireAuthedUser } from "@/lib/brands";
import { generateBrandVariants } from "@/lib/brandVariants";
import { uploadToS3 } from "@/lib/s3";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireAuthedUser();
    const brands = await listBrandsForUser(user.id);
    return NextResponse.json(brands, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch brands";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAuthedUser();

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

      if (typeof rawName !== "string") {
        return NextResponse.json({ error: "Missing field: name" }, { status: 400 });
      }
      if (!(image instanceof File)) {
        return NextResponse.json({ error: "Missing form field: image" }, { status: 400 });
      }

      const name = rawName.trim();
      if (!name) return NextResponse.json({ error: "Brand name is required" }, { status: 400 });

      const mime = (image.type || "image/png").split(";")[0] || "image/png";
      if (!mime.startsWith("image/")) {
        return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
      }
      const imageBytes = Buffer.from(await image.arrayBuffer());
      if (imageBytes.length < 50) {
        return NextResponse.json({ error: "Invalid image payload" }, { status: 400 });
      }

      let variantBuffers: Buffer[];
      try {
        variantBuffers = await generateBrandVariants(imageBytes);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Variant generation failed";
        return NextResponse.json({ error: msg }, { status: 500 });
      }

      let publicUrls: string[];
      try {
        publicUrls = await Promise.all(
          variantBuffers.map((buf, idx) =>
            uploadToS3(buf, "brand-variants", `brand-v${idx + 1}`, "png", "image/png"),
          ),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to upload variants";
        return NextResponse.json({ error: msg }, { status: 500 });
      }

      const created = await createBrandForUser({
        ownerId: user.id,
        name,
        imageUrl: publicUrls[0] ?? "",
        logoVariants: publicUrls,
        createdByEmail: user.email,
      });
      return NextResponse.json({ brand: created, variants: publicUrls }, { status: 201 });
    }

    // Back-compat: JSON body { name, imageUrl }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
    }

    const name = (body as { name?: unknown } | null)?.name;
    const imageUrl = (body as { imageUrl?: unknown } | null)?.imageUrl;
    if (typeof name !== "string" || typeof imageUrl !== "string") {
      return NextResponse.json({ error: "Missing fields: name, imageUrl" }, { status: 400 });
    }

    const created = await createBrandForUser({
      ownerId: user.id,
      name,
      imageUrl,
      logoVariants: [imageUrl],
      createdByEmail: user.email,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create brand";
    const status =
      msg === "Unauthorized" ? 401 : /required|missing/i.test(msg) ? 400 : /unique|duplicate/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
