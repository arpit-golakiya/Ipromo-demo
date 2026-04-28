import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";

type TemplateRow = {
  id: string | number;
  name: string | null;
  pages: unknown | null;
  created_at: unknown | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const awaitedParams = await params;
  const id = (awaitedParams?.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "Missing template id" }, { status: 400 });
  }

  try {
    const { rows } = await dbQuery<TemplateRow>(
      `select id, name, pages, created_at
       from preload_templates
       where id::text = $1
       limit 1`,
      [id],
    );

    const row = rows[0] ?? null;
    if (!row) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch template";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}