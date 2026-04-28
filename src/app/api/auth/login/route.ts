import { NextResponse } from "next/server";
import { createSession, setSessionCookie, verifyUserCredentials } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const email = (body as { email?: unknown } | null)?.email;
  const password = (body as { password?: unknown } | null)?.password;

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Missing fields: email, password" }, { status: 400 });
  }

  try {
    const user = await verifyUserCredentials({ email, password });
    if (!user) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    const session = await createSession(user.id);
    await setSessionCookie(session.token, session.expiresAt);
    return NextResponse.json({ user }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Login failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}