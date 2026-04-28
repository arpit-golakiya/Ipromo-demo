import { NextResponse } from "next/server";
import { clearSessionCookie, deleteSessionByToken } from "@/lib/auth";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get("ipromo_session")?.value ?? "";
  if (token) {
    try {
      await deleteSessionByToken(token);
    } catch {
      // ignore
    }
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}