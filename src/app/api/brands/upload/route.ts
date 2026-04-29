import { NextResponse } from "next/server";
import { requireAuthedUser } from "@/lib/brands";
import { uploadToS3 } from "@/lib/s3";

export const runtime = "nodejs";

function extFromMime(mime: string): string {
  const m = mime.toLowerCase().split(";")[0]?.trim() || "";
  if (m === "image/png") return "png";
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  return "png";
}

export async function POST(req: Request) {
  try {
    await requireAuthedUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const mime = (image.type || "image/png").split(";")[0] || "image/png";
  if (!mime.startsWith("image/")) {
    return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
  }

  const bytes = Buffer.from(await image.arrayBuffer());
  if (bytes.length < 50) {
    return NextResponse.json({ error: "Invalid image payload" }, { status: 400 });
  }

  const ext = extFromMime(mime);
  const safeBase = (image.name || "brand").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "brand";
  const publicUrl = await uploadToS3(bytes, "brand-logos", safeBase, ext, mime);

  return NextResponse.json({ publicUrl }, { status: 200 });
}
