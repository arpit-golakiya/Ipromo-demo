import { NextResponse } from "next/server";
import { getLookbookForUser, deleteLookbookForUser } from "@/lib/lookbooks";
import { requireAuthedUser } from "@/lib/brands";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuthedUser();
    const { id } = await params;
    const lookbook = await getLookbookForUser({ ownerId: user.id, lookbookId: id });
    if (!lookbook) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(lookbook, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch lookbook";
    return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" ? 401 : 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuthedUser();
    const { id } = await params;
    const deleted = await deleteLookbookForUser({ ownerId: user.id, lookbookId: id });
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete lookbook";
    return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" ? 401 : 500 });
  }
}
