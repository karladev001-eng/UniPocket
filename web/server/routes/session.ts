import type { Env, User } from "../types.ts";
import { response } from "../shared.ts";
import { ApiError, jsonBody, textField } from "../validation.ts";
import { createSession, requireUser } from "../session.ts";
// /api/session: read, create and rename the anonymous session.
export async function sessionRoute(
  request: Request,
  env: Env,
  user: User | null,
): Promise<Response> {
  const method = request.method;
  if (method === "GET") return response({ user });
  if (method === "POST") {
    const body = await jsonBody(request);
    if (Object.keys(body).length)
      throw new ApiError(400, "セッション作成にユーザーIDは指定できません。");
    if (user) return response({ user });
    const session = await createSession(request, env);
    return response({ user: session.user }, 200, session.cookie);
  }
  if (method === "PATCH") {
    user = requireUser(user);
    const body = await jsonBody(request);
    if (Object.keys(body).length !== 1 || !("displayName" in body))
      throw new ApiError(400, "表示名だけを指定してください。");
    const displayName = textField(body.displayName, "displayName", 40, true);
    await env.DB.prepare("UPDATE profiles SET display_name=? WHERE id=?")
      .bind(displayName, user.id)
      .run();
    return response({ user: { ...user, displayName } });
  }
  throw new ApiError(405, "未対応の操作です。", "method_not_allowed");
}
