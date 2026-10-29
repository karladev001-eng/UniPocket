import { configureWorkerd } from "../scripts/runtime.mjs";
configureWorkerd();
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

// Exercise Wrangler's actual Static Assets routing and persisted local D1 together.
// The temporary database is isolated from developer/browser QA data and never remote.
test(
  "Static Assets + Worker + persisted D1 keep anonymous ownership across restart",
  { timeout: 90000 },
  async () => {
    const state = await mkdtemp(join(tmpdir(), "campus-integration-"));
    const cli = new URL(
      "../node_modules/wrangler/bin/wrangler.js",
      import.meta.url,
    ).pathname;
    let child,
      output = "",
      base;
    const run = (...args) =>
      execFileSync(process.execPath, [cli, ...args], {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      });
    const start = async () => {
      output = "";
      child = spawn(
        process.execPath,
        [
          cli,
          "dev",
          "--env",
          "preview",
          "--ip",
          "127.0.0.1",
          "--port",
          "0",
          "--persist-to",
          state,
        ],
        {
          cwd: new URL("..", import.meta.url),
          env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout.on("data", (b) => {
        output += b;
      });
      child.stderr.on("data", (b) => {
        output += b;
      });
      for (let i = 0; i < 300; i++) {
        const match = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          base = match[1];
          return;
        }
        if (child.exitCode !== null) throw Error(output);
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error("Wrangler startup timed out: " + output);
    };
    const stop = async () => {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
      child = undefined;
    };
    const send = async (path, method = "GET", body, cookie, headers = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          Origin: base,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { response, data: await response.json() };
    };
    try {
      run(
        "d1",
        "migrations",
        "apply",
        "DB",
        "--local",
        "--env",
        "preview",
        "--persist-to",
        state,
      );
      await start();
      const home = await fetch(base + "/");
      assert.equal(home.status, 200);
      assert.match(
        home.headers.get("content-security-policy"),
        /frame-src https:\/\/notion.so/,
      );
      assert.equal(home.headers.get("x-content-type-options"), "nosniff");
      assert.equal(home.headers.get("x-robots-tag"), "noindex,nofollow");
      const html = await home.text();
      assert.match(html, /<script[^>]+src="\/assets\//);
      assert.match(html, /<meta name="robots" content="noindex,nofollow"/);
      assert.match(
        await readFile(new URL("../dist/_headers", import.meta.url), "utf8"),
        /^\/\*\n  X-Robots-Tag: noindex,nofollow/m,
      );
      for (const path of [
        "/install.html",
        "/manifest.webmanifest",
        html.match(/<script[^>]+src="([^"]+)"/)[1],
      ])
        assert.equal(
          (await fetch(base + path)).headers.get("x-robots-tag"),
          "noindex,nofollow",
          path,
        );
      // Cache the canonical shell: /index.html redirects under Static Assets and
      // its redirected Response is rejected by real browser navigation fetches.
      const sw = await (await fetch(base + "/sw.js")).text();
      const precached = JSON.parse(sw.match(/ASSETS=(\[[^;]+\]);/)[1]);
      assert.ok(precached.includes("/"));
      assert.ok(!precached.includes("/index.html"));
      const shell = await fetch(base + precached.find((path) => path === "/"));
      assert.equal(shell.redirected, false);
      const deep = await fetch(base + "/articles/local-check", {
        headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" },
      });
      assert.equal(await deep.text(), html);
      const version = await fetch(base + "/version.json");
      assert.equal(version.headers.get("cache-control"), "no-store");
      assert.equal(
        (await version.json()).id,
        JSON.parse(
          await readFile(new URL("../dist/version.json", import.meta.url)),
        ).id,
      );
      assert.equal(
        (await fetch(base + "/sw.js")).headers.get("cache-control"),
        "no-cache",
      );
      assert.equal((await send("/api/articles")).data.articles.length, 0);
      assert.equal((await send("/api/missing")).response.status, 404);
      const session = await send("/api/session", "POST", {});
      assert.equal(session.response.status, 200);
      const setCookie = session.response.headers.get("set-cookie");
      assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/);
      const cookie = setCookie.split(";")[0],
        userId = session.data.user.id;
      const body = {
        title: "ローカル結合検証",
        publicUrl:
          "https://gridfiti.notion.site/Flix-Clock-Widget-Setup-9e19f260d89643ff8273309bde21c471",
        summary: "一時DBのみ。埋め込み成功の検証ではありません。",
        category: "検証",
      };
      const made = await send("/api/articles", "POST", body, cookie, {
        "Idempotency-Key": crypto.randomUUID(),
      });
      assert.equal(made.response.status, 201, JSON.stringify(made.data));
      const id = made.data.article.id;
      assert.equal(
        (
          await send(
            "/api/articles/" + id,
            "PATCH",
            { title: "結合検証・編集後" },
            cookie,
            { "If-Match": String(made.data.article.revision) },
          )
        ).data.article.canEdit,
        true,
      );
      const mark = await send(
        `/api/articles/${id}/bookmark`,
        "PUT",
        {},
        cookie,
      );
      assert.equal(mark.data.bookmarkCount, 1);
      assert.equal(
        mark.response.headers.get("cache-control"),
        "private, no-store",
      );
      assert.equal(
        (await send(`/api/articles/${id}/view`, "POST", {}, cookie)).data
          .viewCount,
        1,
      );
      assert.equal(
        (await send(`/api/articles/${id}/view`, "POST", {}, cookie)).data
          .viewCount,
        1,
      );
      const popular = await send(
        "/api/articles?sort=popular",
        "GET",
        undefined,
        cookie,
      );
      assert.equal(popular.response.status, 200);
      assert.equal(popular.data.articles[0].id, id);
      assert.equal(popular.data.articles[0].viewCount, 1);
      assert.equal(popular.data.articles[0].bookmarkCount, 1);
      assert.ok(!("rankKey" in popular.data.articles[0]));
      assert.equal(
        (await send("/api/articles?sort=unsupported")).response.status,
        400,
      );
      await stop();
      await start();
      assert.equal(
        (await send("/api/session", "GET", undefined, cookie)).data.user.id,
        userId,
      );
      const restored = (
        await send("/api/articles?bookmarked=1", "GET", undefined, cookie)
      ).data.articles;
      assert.equal(restored.length, 1);
      assert.equal(restored[0].id, id);
      assert.equal(restored[0].title, "結合検証・編集後");
      assert.equal(restored[0].bookmarked, true);
      const popularRestored = (
        await send(
          "/api/articles?sort=popular&bookmarked=1",
          "GET",
          undefined,
          cookie,
        )
      ).data.articles;
      assert.deepEqual(popularRestored, restored);
      assert.equal(
        (
          await send(
            "/api/articles?authorId=" + userId,
            "GET",
            undefined,
            cookie,
          )
        ).data.articles.length,
        1,
      );
      assert.equal(
        (await send("/api/articles/" + id, "PATCH", { title: "権限なし" }))
          .response.status,
        401,
      );
      assert.equal(
        (
          await send("/api/session", "POST", {}, cookie, {
            Origin: "https://attacker.example",
          })
        ).response.status,
        403,
      );
    } finally {
      await stop();
      await rm(state, { recursive: true, force: true });
    }
  },
);
