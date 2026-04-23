import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

type FeedbackPayload = {
  message: string;
  path?: string | null;
};

export async function POST(req: NextRequest) {
  let body: FeedbackPayload;
  try {
    body = (await req.json()) as FeedbackPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const message = String(body?.message ?? "").trim();
  if (message.length < 3 || message.length > 4000) {
    return NextResponse.json(
      { ok: false, error: "Message must be between 3 and 4000 characters" },
      { status: 400 },
    );
  }

  const path = typeof body?.path === "string" ? body.path.slice(0, 500) : null;
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;
  const referer = req.headers.get("referer")?.slice(0, 1000) ?? null;

  try {
    await dbQuery(
      `insert into main_feedback (message, path, user_agent, referer)
       values ($1, $2, $3, $4)`,
      [message, path, userAgent, referer],
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

