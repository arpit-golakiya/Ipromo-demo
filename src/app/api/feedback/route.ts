import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase";

type FeedbackPayload = {
  v: 1;
  question: string;
  answer: string;
  meta?: {
    pathname?: string;
    userAgent?: string;
    submittedAtIso?: string;
  };
};

const TABLE = "feedback";

export async function POST(req: NextRequest) {
  let payload: FeedbackPayload;
  try {
    payload = (await req.json()) as FeedbackPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload || payload.v !== 1) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const question = (payload.question ?? "").trim();
  const answer = (payload.answer ?? "").trim();

  if (!answer) {
    return NextResponse.json({ error: "Missing answer" }, { status: 400 });
  }

  try {
    const supabase = createServerSupabaseAdminClient();
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        feedback: answer,
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to submit feedback" },
        { status: 502 },
      );
    }

    return NextResponse.json({ id: data.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}