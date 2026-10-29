import type { Database, Env, User } from "./types.ts";
import { digest, rate } from "./shared.ts";
import { ApiError } from "./validation.ts";
// Anonymous cookie sessions: identity is the verified cookie, never a client-supplied ID.
const COOKIE = "__Host-campus_session";
const SESSION_SECONDS = 60 * 60 * 24 * 365;
export async function currentUser(
  request: Request,
  db: Database,
): Promise<User | null> {
  const cookies = (request.headers.get("Cookie") || "")
    .split(";")
    .map((v) => v.trim());
  const values = cookies.filter((v) => v.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(COOKIE.length + 1);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db
    .prepare(
      `SELECT p.id, p.display_name AS displayName FROM sessions s JOIN profiles p ON p.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND p.author_kind='user'`,
    )
    .bind(await digest(token), Math.floor(Date.now() / 1000))
    .first<User>();
}
export function requireUser(user: User | null): User {
  if (!user)
    throw new ApiError(
      401,
      "匿名セッションを準備してから再試行してください。",
      "session_required",
    );
  return user;
}
export async function createSession(
  request: Request,
  env: Env,
): Promise<{
  user: User;
  cookie: string;
}> {
  await rate(
    env.DB,
    `session:${request.headers.get("CF-Connecting-IP") || "local"}`,
    300,
    3600,
  );
  const user = { id: crypto.randomUUID(), displayName: "匿名ユーザー" };
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO profiles(id,display_name,created_at) VALUES(?,?,?)",
    ).bind(user.id, user.displayName, new Date().toISOString()),
    env.DB.prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
    ).bind(await digest(token), user.id, now + SESSION_SECONDS),
  ]);
  return {
    user,
    cookie: `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
  };
}
