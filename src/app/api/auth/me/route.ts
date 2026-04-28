import { NextResponse } from "next/server";
import { getAuthedUserOrNullFromCookies, getEnhanceQuotaForUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getAuthedUserOrNullFromCookies();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const enhance = await getEnhanceQuotaForUser(user.id).catch(() => null);
  return NextResponse.json({ user, ...(enhance ? { enhance } : {}) });
}