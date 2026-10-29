import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { startQa, startCookieRelay } from "./helpers/public-admin-qa.mjs";

// Runs built product HTML/JS through both actual Workers and the same ephemeral D1.
test(
  "built public/admin applications share content while retaining HTTP and auth boundaries",
  { timeout: 60000 },
  async () => {
    const qa = await startQa({ publicPort: 0, adminPort: 0 });
    try {
      const send = async (
        base,
        path,
        method = "GET",
        body,
        cookie,
        extra = {},
      ) => {
        const response = await fetch(base + path, {
          method,
          headers: {
            Origin: base,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(cookie ? { Cookie: cookie } : {}),
            ...extra,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
        return { status: response.status, headers: response.headers, data };
      };
      const home = await send(qa.publicUrl, "/"),
        adminHome = await send(qa.adminUrl, "/");
      assert.equal(home.status, 200);
      assert.equal(adminHome.status, 200);
      assert.equal(adminHome.headers.get("cache-control"), "private, no-store");
      for (const [base, shell] of [
        [qa.publicUrl, home],
        [qa.adminUrl, adminHome],
      ]) {
        const sources = [
          ...shell.data.matchAll(/<script[^>]+src="([^"]+)"/g),
        ].map((match) => match[1]);
        assert.ok(sources.length);
        for (const src of sources) {
          const js = await send(base, src);
          assert.equal(js.status, 200);
          assert.match(js.headers.get("content-type"), /javascript/);
          assert.ok(!String(js.data).includes("test-admin-audience"));
          assert.ok(!String(js.data).includes("/__test_cleanup"));
        }
      }
      assert.equal((await send(qa.publicUrl, "/api/admin/me")).status, 404);
      assert.equal((await send(qa.adminUrl, "/sw.js")).status, 404);
      assert.equal((await send(qa.publicUrl, "/__test_cleanup")).status, 404);
      assert.equal((await send(qa.adminUrl, "/__test_cleanup")).status, 404);
      // Verify fail-closed auth directly. QA relay intentionally authenticates admin.
      assert.equal(
        (
          await qa.runtime.send(
            "/",
            "GET",
            undefined,
            undefined,
            { "Cf-Access-Jwt-Assertion": "" },
            "admin",
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await qa.runtime.send(
            "/api/admin/me",
            "GET",
            undefined,
            undefined,
            { "Cf-Access-Jwt-Assertion": "" },
            "admin",
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await send(
            qa.adminUrl,
            "/api/admin/announcements",
            "POST",
            {},
            undefined,
            { Origin: qa.publicUrl },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await send(qa.publicUrl, "/api/session", "POST", {}, undefined, {
            Origin: qa.adminUrl,
          })
        ).status,
        403,
      );
      const session = await send(qa.publicUrl, "/api/session", "POST", {});
      assert.equal(session.status, 200);
      const cookie = session.headers.get("set-cookie").split(";")[0];
      assert.match(cookie, /^qa_public_campus_session=/);
      assert.ok(!session.headers.get("set-cookie").includes("Secure"));
      assert.equal(
        (await send(qa.publicUrl, "/api/session", "GET", undefined, cookie))
          .data.user.id,
        session.data.user.id,
      );
      const mixed =
        "__Host-campus_session=" +
        "f".repeat(64) +
        "; unrelated=ignored; " +
        cookie;
      assert.equal(
        (await send(qa.publicUrl, "/api/session", "GET", undefined, mixed)).data
          .user.id,
        session.data.user.id,
      );
      assert.equal(
        (
          await send(
            qa.publicUrl,
            "/api/session",
            "GET",
            undefined,
            cookie.replace("qa_public_campus_session", "__Host-campus_session"),
          )
        ).data.user,
        null,
      );
      const relay = await startCookieRelay({ port: 0, target: qa.publicUrl });
      try {
        assert.equal(
          (await send(relay.publicUrl, "/api/session", "GET", undefined, mixed))
            .data.user.id,
          session.data.user.id,
        );
        assert.equal(
          (
            await send(relay.publicUrl, "/api/session", "POST", {}, mixed, {
              Origin: qa.adminUrl,
            })
          ).status,
          403,
        );
      } finally {
        await relay.close();
      }
      const notice = await send(
        qa.publicUrl,
        "/api/announcements/" + qa.fixtures.noticeId,
      );
      assert.equal(notice.status, 200);
      assert.equal(notice.data.announcement.revision, 2);
      const detail = await send(
        qa.publicUrl,
        "/api/surveys/" + qa.fixtures.surveyId,
        "GET",
        undefined,
        cookie,
      );
      assert.equal(detail.data.answered, false);
      const survey = detail.data.survey,
        key = crypto.randomUUID();
      const answers = {
        answers: survey.questions.map((q) => ({
          questionId: q.id,
          value: q.type === "text" ? "=1+1" : q.options[0].id,
        })),
      };
      const first = await send(
        qa.publicUrl,
        `/api/surveys/${survey.id}/responses`,
        "POST",
        answers,
        cookie,
        { "Idempotency-Key": key },
      );
      assert.equal(first.status, 200);
      const retry = await send(
        qa.publicUrl,
        `/api/surveys/${survey.id}/responses`,
        "POST",
        answers,
        cookie,
        { "Idempotency-Key": key },
      );
      assert.equal(retry.data.responseId, first.data.responseId);
      assert.equal(
        (
          await send(
            qa.publicUrl,
            "/api/surveys/" + survey.id,
            "GET",
            undefined,
            cookie,
          )
        ).data.answered,
        true,
      );
      const results = await send(
        qa.adminUrl,
        `/api/admin/surveys/${survey.id}/results`,
      );
      assert.equal(results.data.responseCount, 2);
      assert.equal(results.data.resultsComplete, true);
      assert.equal(results.data.questions[0].counts[0].count, 2);
      assert.match(
        (
          await send(
            qa.adminUrl,
            `/api/admin/surveys/${survey.id}/responses.csv`,
          )
        ).data,
        /'=1\+1/,
      );
      const article = (await send(qa.adminUrl, "/api/admin/articles")).data
        .articles[0];
      const hide = await send(
        qa.adminUrl,
        `/api/admin/articles/${article.id}/visibility`,
        "POST",
        {
          revision: article.revision,
          visibility: "hidden",
          reason: "ローカル結合確認",
        },
        undefined,
        { "Idempotency-Key": crypto.randomUUID() },
      );
      assert.equal(hide.status, 200);
      assert.equal(
        (await send(qa.publicUrl, "/api/articles/" + article.id)).status,
        404,
      );
      assert.ok(
        !(await send(qa.publicUrl, "/api/articles")).data.articles.some(
          (a) => a.id === article.id,
        ),
      );
      const reveal = await send(
        qa.adminUrl,
        `/api/admin/articles/${article.id}/visibility`,
        "POST",
        {
          revision: hide.data.article.revision,
          visibility: "published",
          reason: "",
        },
        undefined,
        { "Idempotency-Key": crypto.randomUUID() },
      );
      assert.equal(reveal.status, 200);
      assert.equal(
        (await send(qa.publicUrl, "/api/articles/" + article.id)).status,
        200,
      );
      const publicFiles = await readdir(new URL("../dist/", import.meta.url), {
        recursive: true,
      });
      const adminFiles = await readdir(
        new URL("../dist-admin/", import.meta.url),
        { recursive: true },
      );
      assert.ok(!publicFiles.some((path) => path.includes("admin")));
      assert.ok(
        !adminFiles.some((path) =>
          /(^|\/)(sw\.js|manifest\.webmanifest|pdfs|papers|data)$/.test(path),
        ),
      );
      for (const file of adminFiles.filter((file) => /\.js$/.test(file)))
        assert.doesNotMatch(
          await readFile(
            new URL("../dist-admin/" + file, import.meta.url),
            "utf8",
          ),
          /serviceWorker|caches\.open/,
        );
    } finally {
      await qa.close();
    }
  },
);

test(
  "appearance QA serves synthetic embed/owner/hidden fixtures without changing public detail visibility",
  { timeout: 60000 },
  async () => {
    const qa = await startQa({ publicPort: 0, adminPort: 0, appearance: true });
    try {
      const get = async (path) => {
        const r = await fetch(qa.publicUrl + path);
        return { status: r.status, body: await r.json() };
      };
      const own = await get("/api/articles/" + qa.fixtures.ownerId);
      assert.equal(own.status, 200);
      assert.equal(own.body.article.canEdit, true);
      const embedded = await get("/api/articles/" + qa.fixtures.embeddedId);
      assert.equal(embedded.status, 200);
      assert.equal(embedded.body.article.title, "☆記事の公開方法☆");
      assert.match(
        embedded.body.article.embedUrl,
        /^https:\/\/stirring-nylon-c5a\.notion\.site\/ebd\//,
      );
      assert.equal(embedded.body.article.canEdit, false);
      assert.equal(
        (await get("/api/articles/" + qa.fixtures.hiddenId)).status,
        404,
      );
      const mine = await get("/api/my/articles");
      assert.ok(
        mine.body.articles.some(
          (a) => a.id === qa.fixtures.hiddenId && a.visibility === "hidden",
        ),
      );
      assert.ok(
        !(await get("/api/articles")).body.articles.some(
          (a) => a.id === qa.fixtures.hiddenId,
        ),
      );
      const html = await (await fetch(qa.publicUrl)).text();
      assert.match(html, /<script src="\/appearance-boot\.js"><\/script>/);
      const boot = await fetch(qa.publicUrl + "/appearance-boot.js");
      assert.equal(boot.status, 200);
      assert.match(boot.headers.get("content-type"), /javascript/);
    } finally {
      await qa.close();
    }
  },
);
