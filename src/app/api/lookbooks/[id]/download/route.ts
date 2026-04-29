import { NextResponse } from "next/server";
import { getLookbookForUser } from "@/lib/lookbooks";
import { requireAuthedUser } from "@/lib/brands";
import { lookbookPdfFilename } from "@/lib/lookbookPdfFilename";

export const runtime = "nodejs";

function contentDispositionAttachment(filename: string): string {
  const ascii =
    filename.replace(/[^\x20-\x7E]/g, "_").replace(/\\/g, "\\\\").replace(/"/g, '\\"') ||
    "lookbook.pdf";
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuthedUser();
    const { id } = await params;
    const lookbook = await getLookbookForUser({ ownerId: user.id, lookbookId: id });
    if (!lookbook) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const upstream = await fetch(lookbook.pdfUrl);
    if (!upstream.ok) {
      return NextResponse.json({ error: "Failed to fetch PDF" }, { status: 502 });
    }

    const filename = lookbookPdfFilename(lookbook.title);
    const disposition = contentDispositionAttachment(filename);
    const contentType = upstream.headers.get("content-type") ?? "application/pdf";

    const body = upstream.body;
    if (!body) {
      const buf = await upstream.arrayBuffer();
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": disposition,
        },
      });
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Download failed";
    return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" ? 401 : 500 });
  }
}
