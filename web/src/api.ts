export interface User {
  id: string;
  displayName: string;
}
export interface Article {
  id: string;
  revision: number;
  visibility?: "published" | "hidden";
  hiddenReason?: string;
  authorId: string;
  authorName: string;
  authorKind?: "user" | "admin";
  title: string;
  publicUrl: string;
  embedUrl: string;
  summary: string;
  category: string;
  courseId: string;
  createdAt: string;
  updatedAt: string;
  viewCount: number;
  bookmarkCount: number;
  bookmarked: boolean;
  canEdit: boolean;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const invalidResponse = () =>
    new ApiError(
      "応答を確認できません。通信・認証状態を確認して再試行してください。",
      response.status,
      "invalid_response",
    );
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw invalidResponse();
    value = parsed as Record<string, unknown>;
  } catch {
    throw invalidResponse();
  }
  if (!response.ok)
    throw new ApiError(
      typeof value.error === "string"
        ? value.error
        : `通信に失敗しました (${response.status})`,
      response.status,
      typeof value.code === "string" ? value.code : undefined,
    );
  if ("error" in value) throw invalidResponse();
  return value as T;
}
let sessionPending: Promise<User> | undefined;
async function sessionInsideLock(): Promise<User> {
  const existing = await api<{ user: User | null }>("/session");
  return (
    existing.user ?? (await api<{ user: User }>("/session", "POST", {})).user
  );
}
async function fallbackSessionLock(): Promise<User> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("pocket-session-lock", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("locks");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const owner = crypto.randomUUID(),
    until = Date.now() + 65000;
  try {
    for (;;) {
      const acquired = await new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction("locks", "readwrite"),
          s = tx.objectStore("locks"),
          r = s.get("session");
        let ok = false;
        r.onsuccess = () => {
          if (!r.result || r.result.expires < Date.now()) {
            s.put({ owner, expires: Date.now() + 60000 }, "session");
            ok = true;
          }
        };
        tx.oncomplete = () => resolve(ok);
        tx.onerror = () => reject(tx.error);
      });
      if (acquired) break;
      if (Date.now() > until)
        throw Error(
          "別タブが匿名セッションを準備しています。しばらくして再試行してください。",
        );
      await new Promise((r) => setTimeout(r, 120));
    }
    return await sessionInsideLock();
  } finally {
    await new Promise<void>((resolve) => {
      const tx = db.transaction("locks", "readwrite"),
        s = tx.objectStore("locks"),
        r = s.get("session");
      r.onsuccess = () => {
        if (r.result?.owner === owner) s.delete("session");
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
    });
    db.close();
  }
}
export async function session(): Promise<User> {
  if (!sessionPending)
    sessionPending = (async () =>
      navigator.locks
        ? await navigator.locks.request(
            "pocket-anonymous-session",
            sessionInsideLock,
          )
        : await fallbackSessionLock())().finally(() => {
      sessionPending = undefined;
    });
  return sessionPending!;
}

export function notionURL(value: string): string {
  if (Array.from(value.trim()).length > 2048)
    throw Error("NotionのURLは2048字以内で入力してください。");
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    throw Error("NotionのHTTPS公開URLを入力してください。");
  }
  const host = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.pathname === "/" ||
    /[\\\s]/u.test(value.trim()) ||
    !host
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    !["notion.site", "notion.so"].some(
      (h) => host === h || host.endsWith("." + h),
    )
  )
    throw Error(
      "notion.site / notion.so のHTTPS URLを指定してください。独自ドメインは未対応です。",
    );
  u.hash = "";
  for (const key of [...u.searchParams.keys()])
    if (key.startsWith("utm_") || key === "source") u.searchParams.delete(key);
  u.searchParams.sort();
  if (Array.from(u.href).length > 2048)
    throw Error("NotionのURLは2048字以内で入力してください。");
  return u.href;
}
export function embedSource(value: string): string {
  if (!value.trim()) return "";
  if (value.trim().startsWith("<")) {
    const doc = new DOMParser().parseFromString(value, "text/html");
    const frames = doc.querySelectorAll("iframe");
    if (frames.length !== 1)
      throw Error("公式コードのiframeを1つ入力してください。");
    return notionURL(frames[0].getAttribute("src") ?? "");
  }
  return notionURL(value);
}
