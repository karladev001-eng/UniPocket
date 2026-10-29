/** Structural subset of the Workers D1 API; no runtime dependency. */
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
export interface Env {
  DB: Database;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /** Optional fixed same-origin deployment URL. Never set to * or a list. */
  APP_ORIGIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_OWNER_EMAIL?: string;
}
export interface User { id: string; displayName: string }
export interface Article {
  id: string; authorId: string; authorName: string; authorKind?: "user" | "admin"; title: string;
  publicUrl: string; embedUrl: string; summary: string; category: string;
  courseId: string; createdAt: string; updatedAt: string;
  revision: number; visibility?: 'published' | 'hidden' | 'deleted'; hiddenReason?: string;
  viewCount: number; bookmarkCount: number; bookmarked: boolean; canEdit: boolean;
}
/** Session cookie issued mid-request; error responses still carry it. */
export interface Issued { cookie?: string }
