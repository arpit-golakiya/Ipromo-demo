import { NextResponse } from "next/server";
import { createLookbook, listLookbooksForUser } from "@/lib/lookbooks";
import { requireAuthedUser } from "@/lib/brands";
import { generateLookbook } from "@/lib/lookbookPdf.server";
import { uploadToS3 } from "@/lib/s3";

export const runtime = "nodejs";
export const maxDuration = 120; // PDF generation can take a while for large templates

export async function GET() {
  try {
    const user = await requireAuthedUser();
    const lookbooks = await listLookbooksForUser(user.id);
    return NextResponse.json(lookbooks, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch lookbooks";
    return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" ? 401 : 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAuthedUser();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
    }

    const templateId = (body as { templateId?: unknown } | null)?.templateId;
    const brandId    = (body as { brandId?: unknown }    | null)?.brandId;

    if (typeof templateId !== "string" || !templateId.trim())
      return NextResponse.json({ error: "Missing field: templateId" }, { status: 400 });
    if (typeof brandId !== "string" || !brandId.trim())
      return NextResponse.json({ error: "Missing field: brandId" }, { status: 400 });

    const { pdfBuffer, previewBuffer, title, brandName } = await generateLookbook({
      ownerId:    user.id,
      templateId: templateId.trim(),
      brandId:    brandId.trim(),
    });

    const pdfUrl = await uploadToS3(pdfBuffer, "lookbooks", "lookbook", "pdf", "application/pdf");
    const previewUrl = previewBuffer
      ? await uploadToS3(previewBuffer, "lookbooks/previews", "preview", "png", "image/png")
      : null;

    const lookbook = await createLookbook({
      ownerId:        user.id,
      title,
      brandId:        brandId.trim(),
      brandName,
      templateId:     templateId.trim(),
      pdfUrl,
      previewUrl,
      createdByEmail: user.email,
    });

    return NextResponse.json(lookbook, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create lookbook";
    const status =
      msg === "Unauthorized"   ? 401 :
      /not found/i.test(msg)   ? 404 :
                                 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
