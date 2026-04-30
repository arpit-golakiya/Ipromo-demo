import { NextResponse } from "next/server";
import { getAuthedUserOrNullFromCookies, changePasswordForUser } from "@/lib/auth";

export const runtime = "nodejs";

function isChangePasswordBody(v: unknown): v is { currentPassword: string; newPassword: string } {
  if (!v || typeof v !== "object") return false;
  const o = v as { currentPassword?: unknown; newPassword?: unknown };
  return typeof o.currentPassword === "string" && typeof o.newPassword === "string";
}

export async function POST(req: Request) {
  const user = await getAuthedUserOrNullFromCookies();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  if (!isChangePasswordBody(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    await changePasswordForUser({
      userId: user.id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to change password";
    const status =
      message === "Not authenticated" ? 401 : message === "Current password is incorrect" ? 400 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

