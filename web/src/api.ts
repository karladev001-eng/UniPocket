export interface User {
  id: string;
  displayName: string;
}
export interface Article {
  id: string;
  authorId: string;
  authorName: string;
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
  constructor(message: string, public status: number, public code?: string) {
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
  const value = await response
    .json()
    .catch(() => ({ error: "応答を読み取れません。" }));
  if (!response.ok)
    throw new ApiError(value.error ?? `通信に失敗しました (${response.status})`, response.status, value.code);
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
    !["notion.site", "notion.so"].some(
      (h) => host === h || host.endsWith("." + h),
    )
  )
    throw Error(
      "notion.site / notion.so のHTTPS URLを指定してください。独自ドメインは未対応です。",
    );
  u.hash = "";
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
