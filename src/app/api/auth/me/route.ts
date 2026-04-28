import { NextResponse } from "next/server";
import { getAuthedUserOrNullFromCookies, getEnhanceDailyLimitStatusForUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getAuthedUserOrNullFromCookies();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const enhance = await getEnhanceDailyLimitStatusForUser(user.id).catch(() => ({
    limit: null,
    usedToday: 0,
    remainingToday: null,
    dateUtc: "",
  }));
  return NextResponse.json({
    user,
    ...(typeof enhance.remainingToday === "number" ? { enhance } : {}),
  });
}