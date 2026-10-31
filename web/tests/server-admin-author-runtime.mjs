import test from "node:test";
import assert from "node:assert/strict";
import { runtime, owner } from "./helpers/server-admin-fixture.mjs";
const input = (suffix = crypto.randomUUID()) => ({
  title: "運営記事",
  publicUrl: "https://demo.notion.site/" + suffix + "?utm_source=guide#top",
  summary: "紹介",
  category: "運営",
  courseId: "course-a",
  embedUrl: "",
});
const keyed = () => ({ "Idempotency-Key": crypto.randomUUID() });
const count = async (r, table, where = "1") =>
  (await r.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).first())
    .n;
test("admin authorship: signed create, forged identity denial, public actions and ordinary author isolation", async () => {
  const r = await runtime();
  try {
    const session = await r.session(),
      body = input("guide"),
      headers = keyed();
    for (const claims of [
      { aud: ["other"] },
      { exp: 1 },
      { email: "other@example.test" },
    ])
      assert.equal(
        (
          await r.adm("/articles", "POST", body, {
            ...headers,
            "Cf-Access-Jwt-Assertion": await r.token(claims),
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await r.adm("/articles", "POST", body, {
          ...headers,
          Origin: "https://campus.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await r.send(
          "/api/admin/articles",
          "POST",
          body,
          session.cookie,
          headers,
        )
      ).status,
      404,
    );
    for (const extra of [
      { authorKind: "admin" },
      { authorId: "reserved" },
      { visibility: "published" },
    ]) {
      assert.equal(
        (
          await r.send(
            "/api/articles",
            "POST",
            { ...body, ...extra },
            session.cookie,
            keyed(),
          )
        ).status,
        400,
      );
      assert.equal(
        (await r.adm("/articles", "POST", { ...body, ...extra }, keyed()))
          .status,
        400,
      );
    }
    const created = await r.adm("/articles", "POST", body, headers);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const a = created.data.article;
    assert.equal(a.authorName, "Uni Pocket運営");
    assert.equal(a.authorKind, "admin");
    assert.match(a.authorId, /^admin:[a-f0-9]{48}$/);
    assert.equal(a.publicUrl, "https://demo.notion.site/guide");
    assert.equal(a.revision, 1);
    await r.send(
      "/api/session",
      "PATCH",
      { displayName: a.authorName },
      session.cookie,
    );
    const normal = await r.article(session.cookie);
    assert.equal(normal.authorKind, "user");
    assert.equal(normal.authorName, a.authorName);
    assert.equal(
      (
        await r.adm(
          "/articles/" + normal.id,
          "PATCH",
          { ...body, revision: 1 },
          keyed(),
        )
      ).status,
      403,
    );
    for (const method of ["PATCH", "DELETE"])
      assert.equal(
        (
          await r.send(
            "/api/articles/" + a.id,
            method,
            method === "PATCH" ? { title: "乗っ取り" } : undefined,
            session.cookie,
            { "If-Match": "1" },
          )
        ).status,
        403,
      );
    const publicA = (
      await r.send("/api/articles/" + a.id, "GET", undefined, session.cookie)
    ).data.article;
    assert.equal(publicA.canEdit, false);
    assert.equal(publicA.authorKind, "admin");
    assert.ok(!JSON.stringify(publicA).includes(owner));
    assert.deepEqual(
      (
        await r.send("/api/my/articles", "GET", undefined, session.cookie)
      ).data.articles.map((a) => a.id),
      [normal.id],
    );
    assert.equal(
      (
        await r.send(
          "/api/articles/" + a.id + "/bookmark",
          "PUT",
          {},
          session.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await r.send(
          "/api/articles/" + a.id + "/view",
          "POST",
          {},
          session.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await r.send(
          "/api/articles/" + a.id + "/report",
          "POST",
          { reason: "other", details: "確認" },
          session.cookie,
        )
      ).status,
      200,
    );
    for (const query of ["authorId=" + a.authorId, "bookmarked=1"])
      assert.equal(
        (
          await r.send(
            "/api/articles?" + query,
            "GET",
            undefined,
            session.cookie,
          )
        ).data.articles[0].id,
        a.id,
      );
    const reserved = await r.db
      .prepare("SELECT id FROM profiles WHERE author_kind='admin'")
      .first();
    await assert.rejects(
      r.db
        .prepare(
          "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
        )
        .bind("forged", reserved.id, 9999999999)
        .run(),
      /reserved_author/,
    );
    await assert.rejects(
      r.db.prepare("UPDATE sessions SET user_id=?").bind(reserved.id).run(),
      /reserved_author/,
    );
    await assert.rejects(
      r.db
        .prepare("UPDATE profiles SET display_name='changed' WHERE id=?")
        .bind(reserved.id)
        .run(),
      /reserved_author/,
    );
    await assert.rejects(
      r.db
        .prepare(
          "UPDATE articles SET author_kind='admin',author_id=? WHERE id=?",
        )
        .bind(reserved.id, normal.id)
        .run(),
      /immutable_author/,
    );
  } finally {
    await r.mf.dispose();
  }
});
test("admin article retry/duplicate: concurrent stable keys and normalized URLs never double-create", async () => {
  const r = await runtime();
  try {
    const body = input("one"),
      h = keyed();
    const made = await Promise.all(
      Array.from({ length: 8 }, () => r.adm("/articles", "POST", body, h)),
    );
    for (const m of made) {
      assert.equal(m.status, 201, JSON.stringify(m.data));
      assert.equal(m.data.article.id, made[0].data.article.id);
    }
    assert.equal(await count(r, "articles"), 1);
    assert.equal(
      await count(
        r,
        "admin_audit",
        "action='article.create' AND result='success'",
      ),
      1,
    );
    assert.equal(
      (await r.adm("/articles", "POST", { ...body, title: "different" }, h))
        .data.code,
      "idempotency_conflict",
    );
    const dupe = await r.adm(
      "/articles",
      "POST",
      { ...body, publicUrl: "https://demo.notion.site/one?source=share" },
      keyed(),
    );
    assert.equal(dupe.status, 409);
    assert.equal(dupe.data.code, "duplicate_article");
    assert.equal(dupe.data.articleId, made[0].data.article.id);
    assert.equal(dupe.data.articleUrl, "/#articles/" + dupe.data.articleId);
    const races = await Promise.all(
      Array.from({ length: 5 }, () =>
        r.adm("/articles", "POST", input("two"), keyed()),
      ),
    );
    assert.equal(races.filter((r) => r.status === 201).length, 1);
    assert.equal(
      races.filter(
        (r) => r.status === 409 && r.data.code === "duplicate_article",
      ).length,
      4,
    );
    assert.equal(await count(r, "articles"), 2);
    assert.equal(await count(r, "admin_keys"), 2); // unsuccessful duplicate keys roll back too
  } finally {
    await r.mf.dispose();
  }
});
test("admin edit: revision races, hidden visibility, stable retries and audit failure are atomic", async () => {
  const r = await runtime();
  try {
    const body = input("edit"),
      first = await r.adm("/articles", "POST", body, keyed());
    assert.equal(first.status, 201);
    const id = first.data.article.id;
    const edit = { ...body, title: "edited", revision: 1 },
      h = keyed();
    const edited = await Promise.all(
      Array.from({ length: 5 }, () =>
        r.adm("/articles/" + id, "PATCH", edit, h),
      ),
    );
    for (const e of edited) {
      assert.equal(e.status, 200, JSON.stringify(e.data));
      assert.equal(e.data.article.revision, 2);
    }
    const competing = await Promise.all(
      ["left", "right"].map((title) =>
        r.adm(
          "/articles/" + id,
          "PATCH",
          { ...body, title, revision: 2 },
          keyed(),
        ),
      ),
    );
    assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
    const hidden = await r.adm(
      "/articles/" + id + "/visibility",
      "POST",
      { revision: 3, visibility: "hidden", reason: "確認中" },
      keyed(),
    );
    assert.equal(hidden.status, 200);
    assert.equal(
      (
        await r.adm(
          "/articles/" + id,
          "PATCH",
          { ...body, revision: 3 },
          keyed(),
        )
      ).data.code,
      "revision_conflict",
    );
    const hiddenEdit = await r.adm(
      "/articles/" + id,
      "PATCH",
      { ...body, title: "hidden edit", revision: 4 },
      keyed(),
    );
    assert.equal(hiddenEdit.status, 200);
    assert.equal(hiddenEdit.data.article.visibility, "hidden");
    assert.equal((await r.send("/api/articles/" + id)).status, 404);
    await r.db.exec(
      "CREATE TRIGGER reject_author_audit BEFORE INSERT ON admin_audit WHEN NEW.result='success' BEGIN SELECT RAISE(ABORT,'test_author_audit'); END;",
    );
    const beforeKeys = await count(r, "admin_keys");
    const failedKey = keyed();
    assert.equal(
      (
        await r.adm(
          "/articles/" + id,
          "PATCH",
          { ...body, title: "must roll back", revision: 5 },
          failedKey,
        )
      ).status,
      503,
    );
    assert.equal(
      (await r.adm("/articles/" + id)).data.article.title,
      "hidden edit",
    );
    assert.equal((await r.adm("/articles/" + id)).data.article.revision, 5);
    assert.equal(await count(r, "admin_keys"), beforeKeys);
    assert.equal(
      (await r.adm("/articles", "POST", input("rollback"), keyed())).status,
      503,
    );
    assert.equal(await count(r, "articles"), 1);
    assert.equal(await count(r, "admin_keys"), beforeKeys);
    await r.db.exec("DROP TRIGGER reject_author_audit");
    assert.equal(
      (
        await r.adm(
          "/articles/" + id,
          "PATCH",
          { ...body, title: "must roll back", revision: 5 },
          failedKey,
        )
      ).status,
      200,
    );
    const reveal = await r.adm(
      "/articles/" + id + "/visibility",
      "POST",
      { revision: 6, visibility: "published", reason: "" },
      keyed(),
    );
    assert.equal(reveal.status, 200);
    assert.equal(
      (await r.send("/api/articles/" + id)).data.article.title,
      "must roll back",
    );
    const audits = (
      await r.db
        .prepare("SELECT * FROM admin_audit WHERE result='success'")
        .all()
    ).results;
    assert.ok(audits.every((a) => a.admin_email === owner));
    assert.ok(!JSON.stringify(audits).includes("must roll back"));
    assert.ok(!JSON.stringify(audits).includes(r.jwt));
  } finally {
    await r.mf.dispose();
  }
});
test("admin article validations and write limits fail closed", async () => {
  const r = await runtime();
  try {
    for (const changed of [
      { title: "x".repeat(121) },
      { summary: "x".repeat(281) },
      { category: "x".repeat(61) },
      { courseId: "x".repeat(121) },
      { publicUrl: "http://demo.notion.site/a" },
      { publicUrl: "https://evil.test/a" },
      { publicUrl: "https://notion.site/" },
      { embedUrl: '<iframe src="https://demo.notion.site/a"></iframe>' },
    ])
      assert.equal(
        (await r.adm("/articles", "POST", { ...input(), ...changed }, keyed()))
          .status,
        400,
      );
    assert.equal((await r.adm("/articles", "POST", input())).status, 400);
    // Force the persistent per-owner bucket to its cap without a timing-dependent request loop.
    await r.db.prepare("UPDATE rate_limits SET count=120").run();
    assert.equal(
      (await r.adm("/articles", "POST", input(), keyed())).status,
      429,
    );
  } finally {
    await r.mf.dispose();
  }
});
