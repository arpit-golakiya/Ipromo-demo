import crypto from "node:crypto";
import { cookies } from "next/headers";
import { dbWithClient, dbQuery } from "@/lib/db";

const SESSION_COOKIE = "ipromo_session";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function todayUtcDateString(): string {
  // YYYY-MM-DD in UTC
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function scryptHash(password: string, salt: string): Promise<string> {
  const key = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
  return key.toString("hex");
}

export async function ensureAuthTables(): Promise<void> {
  // Keep schema very small and compatible with plain pg.
  await dbQuery(`
    create table if not exists users (
      id bigserial primary key,
      username text not null,
      email text not null unique,
      password_salt text not null,
      password_hash text not null,
      is_admin boolean not null default false,
      enhance_calls_date date,
      enhance_calls_count integer not null default 0,
      created_at timestamptz not null default now()
    );
  `);

  // Backfill column for existing installs (safe no-op if already present).
  await dbQuery(`alter table users add column if not exists is_admin boolean not null default false;`);

  await dbQuery(`
    create table if not exists user_sessions (
      id bigserial primary key,
      user_id bigint not null references users(id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );
  `);

  await dbQuery(`create index if not exists user_sessions_user_id_idx on user_sessions(user_id);`);
}

export type AuthedUser = { id: string; email: string; username: string; isAdmin: boolean };

export async function createUser(input: {
  username: string;
  email: string;
  password: string;
}): Promise<AuthedUser> {
  await ensureAuthTables();
  const username = input.username.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!username) throw new Error("Username is required");
  if (!email) throw new Error("Email is required");
  if (!password || password.length < 6) throw new Error("Password must be at least 6 characters");

  const salt = randomToken(16);
  const passwordHash = await scryptHash(password, salt);

  const { rows } = await dbQuery<{ id: string; email: string; username: string; isAdmin: boolean }>(
    `
    insert into users (username, email, password_salt, password_hash)
    values ($1, $2, $3, $4)
    returning id::text as id, email, username, is_admin as "isAdmin"
    `,
    [username, email, salt, passwordHash],
  );

  const user = rows[0];
  if (!user) throw new Error("Failed to create user");
  return { id: user.id, email: user.email, username: user.username, isAdmin: Boolean(user.isAdmin) };
}

export async function verifyUserCredentials(input: {
  email: string;
  password: string;
}): Promise<AuthedUser | null> {
  await ensureAuthTables();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email || !password) return null;

  const { rows } = await dbQuery<{
    id: string;
    email: string;
    username: string;
    isAdmin: boolean;
    password_salt: string;
    password_hash: string;
  }>(
    `
    select id::text as id,
           email,
           username,
           is_admin as "isAdmin",
           password_salt,
           password_hash
    from users
    where email = $1
    limit 1
    `,
    [email],
  );

  const row = rows[0];
  if (!row) return null;

  const computed = await scryptHash(password, row.password_salt);
  const ok = crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(row.password_hash, "hex"));
  if (!ok) return null;

  return { id: row.id, email: row.email, username: row.username, isAdmin: Boolean(row.isAdmin) };
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  await ensureAuthTables();

  const sessionDays = Number(process.env.SESSION_DAYS ?? "14");
  const days = Number.isFinite(sessionDays) && sessionDays > 0 ? Math.trunc(sessionDays) : 14;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const token = randomToken(32);
  const tokenHash = sha256Hex(`${requiredEnv("AUTH_SECRET")}:${token}`);

  await dbQuery(
    `
    insert into user_sessions (user_id, token_hash, expires_at)
    values ($1::bigint, $2, $3)
    `,
    [userId, tokenHash, expiresAt.toISOString()],
  );

  return { token, expiresAt };
}

export async function deleteSessionByToken(token: string): Promise<void> {
  await ensureAuthTables();
  const tokenHash = sha256Hex(`${requiredEnv("AUTH_SECRET")}:${token}`);
  await dbQuery(`delete from user_sessions where token_hash = $1`, [tokenHash]);
}

export async function getUserFromSessionToken(token: string): Promise<AuthedUser | null> {
  if (!token) return null;
  await ensureAuthTables();

  const tokenHash = sha256Hex(`${requiredEnv("AUTH_SECRET")}:${token}`);
  const { rows } = await dbQuery<{ id: string; email: string; username: string; isAdmin: boolean }>(
    `
    select u.id::text as id, u.email, u.username, u.is_admin as "isAdmin"
    from user_sessions s
    join users u on u.id = s.user_id
    where s.token_hash = $1
      and s.expires_at > now()
    limit 1
    `,
    [tokenHash],
  );
  const u = rows[0];
  return u ? { id: u.id, email: u.email, username: u.username, isAdmin: Boolean(u.isAdmin) } : null;
}

export async function getAuthedUserOrNullFromCookies(): Promise<AuthedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? "";
  if (!token) return null;
  try {
    return await getUserFromSessionToken(token);
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

export async function consumeEnhanceQuotaOrThrow(userId: string): Promise<{ remaining: number }> {
  await ensureAuthTables();
  const today = todayUtcDateString();

  return await dbWithClient(async (client) => {
    await client.query("begin");
    try {
      const { rows } = await client.query<{
        enhance_calls_date: string | null;
        enhance_calls_count: number;
      }>(
        `
        select enhance_calls_date::text as enhance_calls_date, enhance_calls_count
        from users
        where id = $1::bigint
        for update
        `,
        [userId],
      );

      const row = rows[0];
      if (!row) throw new Error("User not found");

      const isSameDay = row.enhance_calls_date === today;
      const current = isSameDay ? Number(row.enhance_calls_count ?? 0) : 0;

      if (current >= 3) {
        throw new Error("Enhance limit reached (3/day)");
      }

      const next = current + 1;
      await client.query(
        `
        update users
        set enhance_calls_date = $2::date,
            enhance_calls_count = $3
        where id = $1::bigint
        `,
        [userId, today, next],
      );

      await client.query("commit");
      return { remaining: Math.max(0, 3 - next) };
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  });
}

export async function getEnhanceQuotaForUser(userId: string): Promise<{
  limit: number;
  usedToday: number;
  remainingToday: number;
  dateUtc: string;
}> {
  await ensureAuthTables();
  const today = todayUtcDateString();

  const { rows } = await dbQuery<{ enhance_calls_date: string | null; enhance_calls_count: number }>(
    `
    select enhance_calls_date::text as enhance_calls_date, enhance_calls_count
    from users
    where id = $1::bigint
    limit 1
    `,
    [userId],
  );

  const row = rows[0];
  if (!row) {
    return { limit: 3, usedToday: 0, remainingToday: 3, dateUtc: today };
  }

  const isSameDay = row.enhance_calls_date === today;
  const usedToday = isSameDay ? Math.max(0, Math.trunc(Number(row.enhance_calls_count ?? 0))) : 0;
  const limit = 3;
  const remainingToday = Math.max(0, limit - usedToday);
  return { limit, usedToday, remainingToday, dateUtc: today };
}