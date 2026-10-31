// Worker entry point: guards and dispatches /api requests to the route modules.
// Handlers live in routes/ (session, articles) and content.ts (public announcements/surveys).
export { digest, jstDay } from "./shared.ts";
export { cleanup } from "./maintenance.ts";
import type { Env, Issued } from "./types.ts";
import { publicContent } from "./content.ts";
import { cleanup } from "./maintenance.ts";
import { rate, originCheck, response } from "./shared.ts";
import { ApiError } from "./validation.ts";
import { currentUser } from "./session.ts";
import { sessionRoute } from "./routes/session.ts";
import {
  articleItemRoute,
  articlesRoute,
  myArticlesRoute,
} from "./routes/articles.ts";
async function route(
  request: Request,
  env: Env,
  issued: Issued,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method))
    throw new ApiError(405, "未対応の操作です。", "method_not_allowed");
  if (path === "/api/admin" || path.startsWith("/api/admin/"))
    throw new ApiError(404, "見つかりません。", "not_found");
  if (method !== "GET") originCheck(request, env);
  const user = await currentUser(request, env.DB);
  if (method !== "GET") {
    await rate(
      env.DB,
      `write-ip:${request.headers.get("CF-Connecting-IP") || "local"}`,
      180,
      60,
    );
    if (user) await rate(env.DB, `write-user:${user.id}`, 120, 60);
  }
  if (path === "/api/session") return sessionRoute(request, env, user);
  if (path === "/api/articles") return articlesRoute(request, env, user);
  if (path === "/api/my/articles" && method === "GET")
    return myArticlesRoute(env, user);
  const contentResponse = await publicContent(request, env.DB, user);
  if (contentResponse) return contentResponse;
  return articleItemRoute(request, env, user, issued);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith("/api/"))
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response("Not found", { status: 404 });
    const issued: Issued = {};
    try {
      return await route(request, env, issued);
    } catch (error) {
      if (error instanceof ApiError)
        return response(
          { error: error.message, code: error.code },
          error.status,
          issued.cookie,
        );
      if (error instanceof Error && /article_not_public/.test(error.message))
        return response(
          { error: "記事は公開されていません。", code: "not_found" },
          404,
          issued.cookie,
        );
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: articles.author_id, articles.public_url/.test(
          error.message,
        )
      )
        return response(
          {
            error: "この公開URLはすでに登録されています。",
            code: "duplicate_url",
          },
          409,
          issued.cookie,
        );
      // Never expose SQL, token hashes, profile/session tables, or request bodies.
      console.error("Article API operation failed");
      return response(
        {
          error: "共有機能を利用できません。入力を保持して再試行してください。",
          code: "unavailable",
        },
        503,
        issued.cookie,
      );
    }
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await cleanup(env.DB);
  },
};
