import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";

type PreloadTemplateRow = {
  id: string | number;
  name: string | null;
  pages: unknown | null;
  created_at: unknown | null;
};

export async function GET() {
  try {
    const { rows } = await dbQuery<PreloadTemplateRow>(
      `select id, name, pages, created_at from preload_templates order by created_at desc`,
    );
    return NextResponse.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch templates";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}