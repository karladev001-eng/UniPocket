import { configureWorkerd } from "../scripts/runtime.mjs";
configureWorkerd();
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const { build } = require("esbuild");

async function runtime() {
  const built = await build({
    entryPoints: [new URL("../server/worker.ts", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2023",
  });
  // Miniflare 5 exposes its supported v4-to-v5 option converter for this source form.
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: built.outputFiles[0].text,
      compatibilityDate: "2026-10-18",
      d1Databases: ["DB"],
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    const migration = readdirSync(new URL("../migrations/", import.meta.url))
      .sort()
      .map((f) =>
        readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8"),
      )
      .join("\n");
    // D1 exec accepts complete SQL statements per line. Preserve trigger BEGIN/END.
    const statements =
      migration
        .replace(/^--.*$/gm, "")
        .match(/\s*CREATE TRIGGER[\s\S]*?END;|(?:[^;]+;)/g) || [];
    for (const statement of statements)
      await db.exec(
        statement
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      );
    const send = async (path, method = "GET", body, cookie, extra = {}) => {
      const result = await mf.dispatchFetch(`https://campus.example${path}`, {
        method,
        headers: {
          Origin: "https://campus.example",
          "Content-Type": "application/json",
          "CF-Connecting-IP": "192.0.2.4",
          ...(cookie ? { Cookie: cookie } : {}),
          ...extra,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: result.status,
        data: await result.json(),
        headers: result.headers,
      };
    };
    return { mf, db, send };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}

test("real workerd/D1: migrations, concurrent creation, isolation, bookmarks and views", async () => {
  const { mf, db, send } = await runtime();
  try {
    const one = await send("/api/session", "POST", {});
    assert.equal(one.status, 200);
    const two = await send("/api/session", "POST", {});
    assert.equal(two.status, 200);
    const a = one.headers.get("Set-Cookie").split(";")[0];
    const b = two.headers.get("Set-Cookie").split(";")[0];
    const key = crypto.randomUUID();
    const body = {
      title: "同時作成",
      publicUrl: "https://demo.notion.site/concurrent",
      embedUrl: "https://demo.notion.site/embed/sample",
    };
    const created = await Promise.all(
      Array.from({ length: 12 }, () =>
        send("/api/articles", "POST", body, a, { "Idempotency-Key": key }),
      ),
    );
    for (const result of created)
      assert.equal(result.status, 201, JSON.stringify(result.data));
    const id = created[0].data.article.id;
    for (const result of created) assert.equal(result.data.article.id, id);
    assert.equal((await send("/api/articles")).data.articles.length, 1);
    assert.equal(
      (await send(`/api/articles/${id}`, "PATCH", { title: "不可" }, b)).status,
      403,
    );
    const marked = await Promise.all(
      Array.from({ length: 20 }, () =>
        send(`/api/articles/${id}/bookmark`, "PUT", {}, b),
      ),
    );
    for (const result of marked) {
      assert.equal(result.status, 200);
      assert.equal(result.data.bookmarkCount, 1);
    }
    assert.equal(
      (await send("/api/articles?bookmarked=1", "GET", undefined, a)).data
        .articles.length,
      0,
    );
    assert.equal(
      (await send("/api/articles?bookmarked=1", "GET", undefined, b)).data
        .articles.length,
      1,
    );
    const viewed = await Promise.all(
      Array.from({ length: 20 }, () =>
        send(`/api/articles/${id}/view`, "POST", {}, b),
      ),
    );
    for (const result of viewed) {
      assert.equal(result.status, 200);
      assert.equal(result.data.viewCount, 1);
    }
    const anonymous = await send(`/api/articles/${id}/view`, "POST", {});
    assert.equal(anonymous.data.viewCount, 2);
    const c = anonymous.headers.get("Set-Cookie").split(";")[0];
    assert.ok((await send("/api/session", "POST", {}, c)).data.user.id);
    assert.equal(
      (await send(`/api/articles/${id}/view`, "POST", {}, c)).data.viewCount,
      2,
    );
    assert.equal(
      (await send("/api/articles")).headers.get("Cache-Control"),
      "private, no-store",
    );
    assert.equal(
      (
        await send("/api/session", "POST", {}, undefined, {
          Origin: "https://attacker.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await send("/api/articles", "POST", { ...body, title: "conflict" }, a, {
          "Idempotency-Key": key,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await send("/api/articles", "POST", body, a, {
          "Idempotency-Key": crypto.randomUUID(),
        })
      ).status,
      409,
    );
    await send(`/api/articles/${id}`, "DELETE", undefined, a, {
      "If-Match": "1",
    });
    assert.equal(
      (await send("/api/articles", "POST", body, a, { "Idempotency-Key": key }))
        .status,
      410,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM articles WHERE visibility='deleted'")
          .first()
      ).n,
      1,
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) n FROM view_events").first()).n,
      2,
    );
  } finally {
    await mf.dispose();
  }
});

test("real workerd/D1: popular SQL ranks all rows, filters, and traverses a fixed 7-day window", async () => {
  const { mf, db, send } = await runtime();
  try {
    const session = await send("/api/session", "POST", {});
    assert.equal(session.status, 200);
    const cookie = session.headers.get("Set-Cookie").split(";")[0];
    const author = session.data.user.id;
    const viewers = Array.from({ length: 4 }, () => crypto.randomUUID());
    for (const viewer of viewers)
      await db
        .prepare(
          "INSERT INTO profiles(id,display_name,created_at) VALUES(?,?,?)",
        )
        .bind(viewer, "読者", "2026-01-01T00:00:00.000Z")
        .run();
    const rows = Array.from({ length: 67 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      createdAt: new Date(
        Date.UTC(2026, 0, 1) - Math.floor(i / 3) * 3600000,
      ).toISOString(),
      category: i % 2 ? "生活" : "学習",
      courseId: `course-${i % 3}`,
      title: i % 4 === 0 ? `一致${i}` : `記事${i}`,
      rankKey: (i % 4) + (i % 3) * 3,
    }));
    const initial = await send("/api/articles?sort=popular");
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.data.articles, []);
    // Calculate JST independently of the test host's local timezone.
    const endDay = new Date(Date.now() + 9 * 3600000)
      .toISOString()
      .slice(0, 10);
    const day = (offset) =>
      new Date(Date.parse(endDay) + offset * 86400000)
        .toISOString()
        .slice(0, 10);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      await db
        .prepare(
          `INSERT INTO articles(id,author_id,public_url,title,category,course_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)`,
        )
        .bind(
          row.id,
          author,
          `https://demo.notion.site/rank-${i}`,
          row.title,
          row.category,
          row.courseId,
          row.createdAt,
          row.createdAt,
        )
        .run();
      for (let n = 0; n < i % 4; n++)
        await db
          .prepare("INSERT INTO view_events VALUES(?,?,?)")
          .bind(row.id, viewers[n], day(-6))
          .run();
      for (let n = 0; n < i % 3; n++)
        await db
          .prepare("INSERT INTO bookmarks VALUES(?,?)")
          .bind(viewers[n], row.id)
          .run();
      // Neither the day before this window nor a future day counts in popularity.
      for (const outside of [-7, 1])
        await db
          .prepare("INSERT INTO view_events VALUES(?,?,?)")
          .bind(row.id, viewers[3], day(outside))
          .run();
    }
    // The oldest article is far below the newest page and must nevertheless rank first.
    const winner = rows.at(-1);
    for (let n = 0; n < 4; n++)
      for (const offset of [-1, 0])
        await db
          .prepare("INSERT INTO view_events VALUES(?,?,?)")
          .bind(winner.id, viewers[n], day(offset))
          .run();
    winner.rankKey += 8;
    await db
      .prepare("INSERT INTO bookmarks VALUES(?,?)")
      .bind(author, winner.id)
      .run();
    winner.rankKey += 3;
    const newestOrder = (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
    const popularOrder = (a, b) => b.rankKey - a.rankKey || newestOrder(a, b);
    const expected = [...rows].sort(popularOrder);
    const ids = [];
    let cursor = null;
    let firstCursor;
    do {
      const page = await send(
        `/api/articles?sort=popular&limit=9${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      assert.equal(page.status, 200, JSON.stringify(page.data));
      if (!ids.length) {
        assert.equal(page.data.articles[0].id, winner.id);
        assert.ok(!("rankKey" in page.data.articles[0]));
        assert.equal(page.data.articles[0].viewCount, 12); // 10 recent + 2 outside the window.
        firstCursor = page.data.nextCursor;
      }
      ids.push(...page.data.articles.map((row) => row.id));
      cursor = page.data.nextCursor;
      if (cursor) {
        const window = JSON.parse(atob(cursor));
        assert.equal(window.startDay, day(-6));
        assert.equal(window.endDay, endDay);
      }
      assert.ok(ids.length <= rows.length);
    } while (cursor);
    assert.deepEqual(
      ids,
      expected.map((row) => row.id),
    );
    assert.equal(new Set(ids).size, 67);
    for (const [query, filter] of [
      ["q=一致", (row) => row.title.startsWith("一致")],
      ["category=学習", (row) => row.category === "学習"],
      ["courseId=course-2", (row) => row.courseId === "course-2"],
      [`authorId=${author}`, () => true],
      ["bookmarked=1", (row) => row === winner],
      [
        "q=一致&category=学習&courseId=course-2",
        (row) =>
          row.title.startsWith("一致") &&
          row.category === "学習" &&
          row.courseId === "course-2",
      ],
    ]) {
      const page = await send(
        `/api/articles?sort=popular&limit=50&${query}`,
        "GET",
        undefined,
        cookie,
      );
      assert.equal(page.status, 200);
      assert.deepEqual(
        page.data.articles.map((row) => row.id),
        expected
          .filter(filter)
          .slice(0, 50)
          .map((row) => row.id),
        query,
      );
    }
    const newest = await send("/api/articles?limit=9");
    const explicit = await send("/api/articles?sort=newest&limit=9");
    assert.deepEqual(newest.data, explicit.data);
    assert.ok(Array.isArray(JSON.parse(atob(newest.data.nextCursor))));
    assert.deepEqual(
      newest.data.articles.map((row) => row.id),
      [...rows]
        .sort(newestOrder)
        .slice(0, 9)
        .map((row) => row.id),
    );
    assert.equal(
      (await send(`/api/articles?cursor=${encodeURIComponent(firstCursor)}`))
        .status,
      400,
    );
    assert.equal(
      (
        await send(
          `/api/articles?sort=popular&cursor=${encodeURIComponent(newest.data.nextCursor)}`,
        )
      ).status,
      400,
    );
    assert.equal((await send("/api/articles?sort=other")).status, 400);
    const bad = { ...JSON.parse(atob(firstCursor)), rankKey: -1 };
    assert.equal(
      (
        await send(
          `/api/articles?sort=popular&cursor=${encodeURIComponent(btoa(JSON.stringify(bad)))}`,
        )
      ).status,
      400,
    );
    // A continued request uses its carried window even when it is an older valid period.
    const old = {
      ...JSON.parse(atob(firstCursor)),
      startDay: day(-7),
      endDay: day(-1),
      rankKey: 100,
      createdAt: "2027-01-01T00:00:00.000Z",
    };
    const oldPage = await send(
      `/api/articles?sort=popular&limit=1&cursor=${encodeURIComponent(btoa(JSON.stringify(old)))}`,
    );
    assert.equal(oldPage.status, 200);
    assert.equal(JSON.parse(atob(oldPage.data.nextCursor)).endDay, day(-1));
  } finally {
    await mf.dispose();
  }
});
