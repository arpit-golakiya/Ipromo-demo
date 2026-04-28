import { NextResponse } from "next/server";
import { createSession, createUser, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const username = (body as { username?: unknown } | null)?.username;
  const email = (body as { email?: unknown } | null)?.email;
  const password = (body as { password?: unknown } | null)?.password;

  if (typeof username !== "string" || typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Missing fields: username, email, password" }, { status: 400 });
  }

  try {
    const user = await createUser({ username, email, password });
    const session = await createSession(user.id);
    await setSessionCookie(session.token, session.expiresAt);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Signup failed";
    // Common constraint violation message from Postgres.
    if (/unique/i.test(msg) || /duplicate/i.test(msg)) {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}