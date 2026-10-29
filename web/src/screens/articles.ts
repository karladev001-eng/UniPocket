// Shared Notion articles: list, detail, registration form and reporting, plus the
// community feed (announcements, surveys, own articles) that reuses the article editor.
// Declarations stay export-free because tests/client-article-detail.test.ts and
// tests/client-modal.test.ts run slices of this file in a VM; exports are listed at the end.
import { adminBadge } from "../author-badge";
import { bindArticlePreview } from "../article-preview";
import { Community } from "../community";
import { updateBookmark, appendUnique, BookmarkRequests } from "../article-request";
import { submitNewArticle, bindArticleRecovery, ArticleRecoveryConflict } from "../article-submit";
import { icon, namedAuthor } from "../ui-assets";
import { uid } from "../domain";
import { api, ApiError, session, notionURL, embedSource, type Article, type User } from "../api";
import { action, composing, data, navigate, page, pageEpoch, render, route, trackBusy, updates } from "../app/context";
import { changed, error, save } from "../app/status";
import { btn, choice, empty, esc, field, heading, textfield } from "../ui/html";
import { modal, submitting, val } from "../ui/modal";
// The API session user, cached from each shared-feature request; Settings shows its name.
let user: User | null = null;
function setUser(next: User | null) {
  user = next;
}
// Bookmark, delete and submit requests in flight (see trackBusy).
let busy = 0;
trackBusy(() => busy);
const bookmarkRequests = new BookmarkRequests();
const articleFilters = {
  q: "",
  category: "",
  courseId: "",
  authorId: "",
  bookmarked: "",
};
let articleSort: "popular" | "newest" = "popular";
let priorFilters: typeof articleFilters | undefined,
  articles: Article[] = [],
  nextCursor: string | null = null,
  articleLoading = false,
  articleError = "",
  articleRequest = 0,
  articleFetched = "",
  searchTimer: ReturnType<typeof setTimeout> | undefined;
function articleKey() {
  return JSON.stringify({ ...articleFilters, sort: articleFilters.bookmarked ? "newest" : articleSort });
}
async function loadArticles(more = false) {
  if (more && (articleLoading || !nextCursor)) return;
  const key = articleKey(), request = ++articleRequest, filter = { ...articleFilters },
    sort = filter.bookmarked ? "newest" : articleSort, cursor = more ? nextCursor : null, bookmarkRevision = bookmarkRequests.revision;
  const isCurrent = pageEpoch.scope(location.hash, () => location.hash);
  const current = () => request === articleRequest && key === articleKey() && isCurrent() && route() === "articles" && !location.hash.split("/")[1];
  articleLoading = true; articleError = "";
  if (!more) nextCursor = null;
  if (!more) { articles = []; articleFetched = ""; }
  updateArticleList();
  try {
    if (filter.bookmarked) user = await session();
    if (!current()) return;
    const params = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
    params.set("sort", sort); params.set("limit", "20");
    if (cursor) params.set("cursor", cursor);
    const result = await api<{ articles: Article[]; nextCursor: string | null }>("/articles?" + params);
    if (!current()) return;
    articles = appendUnique(more ? articles : [], bookmarkRequests.reconcile(result.articles, bookmarkRevision));
    nextCursor = result.nextCursor; articleFetched = new Date().toISOString();
  } catch (e) {
    if (!current()) return;
    articleError = e instanceof Error ? e.message : String(e);
  } finally {
    if (current()) { articleLoading = false; updateArticleList(); }
  }
}
function articleStats(a: Article, actionName: string, pending = false) {
  return `<div class="article-stats"><span class="view-count" role="img" aria-label="閲覧${esc(a.viewCount)}回">${icon("eye")}<span aria-hidden="true">${esc(a.viewCount)}</span></span><button type="button" class="bookmark-toggle" data-action="${esc(actionName)}" ${pending ? "disabled" : ""} aria-pressed="${a.bookmarked}" aria-label="ブックマーク${esc(a.bookmarkCount)}件、${a.bookmarked ? "解除する" : "登録する"}">${icon("bookmark")}<span aria-hidden="true">${esc(a.bookmarkCount)}</span></button></div>`;
}
function articleCard(a: Article) {
  action("article-" + a.id, () => (location.hash = "articles/" + a.id));
  if (namedAuthor(a.authorName)) action("author-" + a.id, () => filterAuthor(a.authorId));
  action("bookmark-" + a.id, async () => {
    if (bookmarkRequests.has(a.id)) return;
    const isCurrent = pageEpoch.scope(location.hash, () => location.hash);
    const sync = () => {
      if (route() !== "articles" || location.hash.split("/")[1]) return;
      const current = articles.find(article => article.id === a.id);
      const button = page.querySelector<HTMLButtonElement>(`[data-action="bookmark-${CSS.escape(a.id)}"]`);
      if (!current || !button) return;
      button.disabled = bookmarkRequests.has(a.id);
      button.setAttribute("aria-pressed", String(current.bookmarked));
      button.setAttribute("aria-label", `ブックマーク${current.bookmarkCount}件、${current.bookmarked ? "解除する" : "登録する"}`);
      button.querySelector("span")!.textContent = String(current.bookmarkCount);
    };
    busy++;
    try {
      await bookmarkRequests.update(a.id, async () => {
        user = await session();
        return api<{ bookmarked: boolean; bookmarkCount: number }>("/articles/" + encodeURIComponent(a.id) + "/bookmark", a.bookmarked ? "DELETE" : "PUT", a.bookmarked ? undefined : {});
      }, state => {
        Object.assign(a, state);
        const current = articles.find(article => article.id === a.id);
        if (current) Object.assign(current, state);
      }, sync);
    } catch (e) { if (isCurrent()) error(e); }
    finally { busy--; updates?.activity(); }
  });
  return `<article class="card article-card"><span class="tag">${esc(a.category || "未分類")}</span><h3><button class="article-title" data-action="article-${esc(a.id)}">${esc(a.title)}</button></h3><p class="article-summary">${esc(a.summary)}</p><div class="article-byline">${namedAuthor(a.authorName) ? `<button class="author" data-action="author-${esc(a.id)}">${esc(a.authorName)}</button>` : '<span class="muted">匿名ユーザー</span>'}${adminBadge(a.authorKind)}</div>${articleStats(a, "bookmark-" + a.id, bookmarkRequests.has(a.id))}</article>`;
}

function filterAuthor(id: string) {
  priorFilters = { ...articleFilters };
  articleFilters.authorId = id;
  render();
}
function updateArticleList() {
  const el = page.querySelector("#article-list");
  if (!el || route() !== "articles" || location.hash.split("/")[1]) return;
  el.innerHTML = `${articleError ? `<div class="notice error" role="alert">取得できませんでした。${esc(articleError)} ${btn("再試行", "articles-retry", "smallbtn")}</div>` : ""}${articleError && articles.length ? `<p class="muted">前回取得 ${esc(new Date(articleFetched).toLocaleString("ja-JP"))} の値です。最新の集計は未取得です。</p>` : ""}${articleLoading ? '<p role="status" class="progress">記事を取得しています…</p>' : ""}<div class="cards">${articles.map(articleCard).join("") || (!articleLoading && !articleError ? empty(articleFilters.bookmarked ? "ブックマークはまだありません。" : Object.values(articleFilters).some(Boolean) ? "条件に一致する記事はありません。" : "記事はまだありません。Notionの公開ページを登録できます。") : "")}</div>${nextCursor ? `<div class="toolbar">${btn("さらに読み込む", "articles-more")}</div>` : ""}`;
  action("articles-retry", () => loadArticles());
  action("articles-more", () => loadArticles(true));
}
function filterCount() { return [articleFilters.category, articleFilters.courseId, articleFilters.authorId].filter(Boolean).length; }
function clearArticleConditions() {
  articleFilters.category = articleFilters.courseId = articleFilters.authorId = "";
  priorFilters = undefined;
}
function articleFilterSheet() {
  const draft = { ...articleFilters }, courses = data.imports.flatMap(p => p.courses);
  const categories = [...new Set(["授業", "学生生活", "学習", "その他", articleFilters.category].filter(Boolean))];
  const options = (name: string, items: string[][], value: string) => items.map(([id, label]) => `<label class="filter-option"><span>${esc(label)}</span><input type="radio" name="${name}" value="${esc(id)}" ${id === value ? "checked" : ""}><span class="filter-check" aria-hidden="true">✓</span></label>`).join("");
  const d = modal("記事を絞り込む", `<fieldset><legend>カテゴリ</legend>${options("category", [["", "すべて"], ...categories.map(c => [c, c])], draft.category)}</fieldset><fieldset><legend>講義</legend>${options("courseId", [["", "すべて"], ...courses.map(c => [c.id, c.title]), ...(draft.courseId && !courses.some(c => c.id === draft.courseId) ? [[draft.courseId, "現在の講義条件"]] : [])], draft.courseId)}</fieldset>${draft.authorId ? '<label class="filter-option"><span>選択中の投稿者で絞り込む</span><input type="checkbox" name="keepAuthor" checked></label>' : ""}<button type="button" id="article-filter-reset" class="text-action">条件を解除</button>`, form => {
    articleFilters.category = val(form, "category");
    articleFilters.courseId = val(form, "courseId");
    articleFilters.authorId = new FormData(form).has("keepAuthor") ? draft.authorId : "";
    d.close(); render();
  }, "適用", { className: "article-filter" });
  d.querySelector<HTMLButtonElement>("#article-filter-reset")!.onclick = () => { clearArticleConditions(); d.close(); render(); };
}
function renderArticles() {
  const id = location.hash.split("/")[1];
  if (id) { void renderArticleDetail(id); return; }
  action("article-new", () => articleForm());
  action("article-filters", articleFilterSheet);
  action("article-clear-filters", () => { clearArticleConditions(); render(); });
  action("author-back", () => {
    if (priorFilters) Object.assign(articleFilters, priorFilters); else articleFilters.authorId = "";
    priorFilters = undefined; render();
  });
  const tab = articleFilters.bookmarked ? "bookmarks" : articleSort, count = filterCount();
  page.innerHTML = `<div class="article-list-heading"><h1>記事</h1><div class="article-heading-actions"><a href="#my-articles">自分の投稿</a>${btn("＋ 登録", "article-new", "article-register")}</div></div>` +
    `<div class="article-search-row"><input id="article-query" type="search" placeholder="タイトル・紹介文で検索" value="${esc(articleFilters.q)}" aria-label="記事検索"><button type="button" class="article-filter-button" data-action="article-filters" aria-label="記事を絞り込む、${count}件適用">${icon("sliders")}<span>${count || ""}</span></button></div><div class="article-tabs" role="group" aria-label="記事の並びと対象">${[["popular", "人気"], ["newest", "新着"], ["bookmarks", "ブックマーク"]].map(([value, label]) => `<button type="button" data-action="articles-${value}" aria-pressed="${tab === value}" class="${tab === value ? "selected" : ""}">${label}</button>`).join("")}</div>${count ? `<div class="article-filter-state">${count}件の条件を適用 ${btn("解除", "article-clear-filters", "text-action")}${articleFilters.authorId && priorFilters ? btn("元の検索へ", "author-back", "text-action") : ""}</div>` : ""}<div id="article-list"></div>`;
  for (const value of ["popular", "newest", "bookmarks"] as const) action("articles-" + value, () => {
    articleFilters.bookmarked = value === "bookmarks" ? "1" : "";
    if (value !== "bookmarks") articleSort = value;
    clearTimeout(searchTimer); render();
  });
  page.querySelector<HTMLInputElement>("#article-query")!.oninput = e => {
    articleFilters.q = (e.target as HTMLInputElement).value;
    // Invalidate now, before the debounce, so an older in-flight result cannot flash.
    articleRequest++; articleLoading = false; nextCursor = null; articles = []; articleError = "";
    updateArticleList(); clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (route() === "articles" && !location.hash.split("/")[1]) void loadArticles(); }, 350);
  };
  clearTimeout(searchTimer);
  updateArticleList(); void loadArticles();
}

let detailRequest = 0;
async function renderArticleDetail(id: string) {
  const request = ++detailRequest;
  const scope = pageEpoch.scope("#articles/" + id, () => location.hash);
  const isCurrent = () => request === detailRequest && scope();
  action("detail-retry", () => renderArticleDetail(id));
  page.innerHTML = '<div class="article-detail"><a class="article-back" href="#articles">‹ 記事一覧</a><p role="status">読み込み中…</p></div>';
  let a: Article;
  try {
    user = await session();
    if (!navigator.onLine) throw Error("オフラインです");
    a = (await api<{ article: Article }>("/articles/" + encodeURIComponent(id)))
      .article;
    if (a.visibility === "hidden") throw new ApiError("記事を表示できません", 404);
  } catch (e) {
    if (!isCurrent()) return;
    const unavailable = e instanceof ApiError && [404, 410].includes(e.status);
    page.innerHTML = `<div class="article-detail"><h1>${navigator.onLine ? "記事を表示できません" : "オフラインです"}</h1><div class="article-detail-state" role="alert">${unavailable ? "非表示・削除された記事です。" : "通信を確認して再試行してください。"}</div><div class="article-detail-tools">${unavailable ? "" : btn("再試行", "detail-retry")}<a href="#articles">記事一覧</a></div></div>`;
    return;
  }
  if (!isCurrent()) return;
  const syncStats = () => {
    if (!isCurrent()) return;
    const stats = page.querySelector(".article-stats");
    if (stats) stats.outerHTML = articleStats(a, "detail-bookmark");
  };
  const draw = () => {
    if (!isCurrent()) return;
    action("detail-bookmark", async () => {
      const b = page.querySelector<HTMLButtonElement>(
        "[data-action=detail-bookmark]",
      );
      if (b) b.disabled = true;
      busy++;
      try {
        await updateBookmark(
          a,
          async () => {
            user = await session();
            return api<{ bookmarked: boolean; bookmarkCount: number }>(
              "/articles/" + encodeURIComponent(id) + "/bookmark",
              a.bookmarked ? "DELETE" : "PUT",
              a.bookmarked ? undefined : {},
            );
          },
          isCurrent,
          syncStats,
        );
      } catch (e) {
        if (isCurrent()) {
          error(e);
          if (b) b.disabled = false;
        }
      } finally {
        busy--;
        updates?.activity();
      }
    });
    if (namedAuthor(a.authorName)) action("detail-author", () => {
      location.hash = "articles";
      filterAuthor(a.authorId);
    });
    action("detail-edit", () => articleForm(a));
    action("detail-delete", async () => {
      if (
        !confirm("登録した記事情報を削除しますか？Notion本文は削除されません。")
      )
        return;
      busy++;
      try {
        await api("/articles/" + encodeURIComponent(id), "DELETE", undefined, { "If-Match": String(a.revision) });
        location.hash = "articles";
      } catch (e) {
        error(e);
      } finally {
        busy--;
        updates?.activity();
      }
    });
    action("frame-retry", () => renderArticleDetail(id));
    action("detail-report", () => reportArticle(a));
    let publicURL = "",
      embedURL = "";
    try {
      publicURL = notionURL(a.publicUrl);
      embedURL = navigator.onLine && a.embedUrl ? notionURL(a.embedUrl) : "";
    } catch {
      error(Error("保存されたNotion URLを安全に表示できません。"));
    }
    page.innerHTML = `<article class="article-detail"><div class="article-detail-top"><a class="article-back" href="#articles">‹ 記事一覧</a><span class="tag">${esc(a.category || "未分類")}</span></div><h1>${esc(a.title)}</h1><p class="article-intro">${esc(a.summary)}</p><div class="article-detail-meta"><div class="article-byline">${namedAuthor(a.authorName) ? `<button class="author" data-action="detail-author">${esc(a.authorName)}</button>` : '<span class="muted">匿名ユーザー</span>'}${adminBadge(a.authorKind)}</div>${articleStats(a, "detail-bookmark")}${a.canEdit ? `<details class="article-owner-menu"><summary aria-label="投稿者の操作">${icon("more")}</summary><div>${btn("登録情報を編集", "detail-edit")}${btn("登録を削除", "detail-delete", "danger")}</div></details>` : ""}</div><div class="article-detail-tools">${btn("通報", "detail-report")}${embedURL ? btn("再読み込み", "frame-retry") : ""}${publicURL ? `<a href="${esc(publicURL)}" target="_blank" rel="noopener noreferrer">Notionで開く ↗</a>` : ""}</div>${embedURL ? `<iframe class="article-frame" title="${esc(a.title)} — Notion本文" src="${esc(embedURL)}" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen"></iframe>` : '<p class="article-detail-state" role="status">埋め込み未登録</p>'}</article>`;
  };
  draw();
  try {
    const value = await api<{ viewCount: number }>(
      "/articles/" + encodeURIComponent(id) + "/view",
      "POST",
      {},
    );
    a.viewCount = value.viewCount;
    syncStats();
  } catch (e) {
    if (!isCurrent()) return;
    error(
      Error(
        "閲覧記録を保存できませんでした。",
      ),
    );
  }
}
const anonymousNotice =
  "このブラウザの匿名ユーザーとして保存・投稿します。別ブラウザ・別端末は別ユーザーです。ブラウザデータやセッションを消すと、以前の保存と投稿の編集権限は復元できません。";
function articleForm(article?: Article) {
  const kind = article?.id ?? "new";
  if (
    data.articleDraft.kind !== kind &&
    Object.values(data.articleDraft).some(Boolean) &&
    !confirm("保存中の別の登録下書きがあります。新しい入力に切り替えますか？")
  )
    return;
  if (data.articleDraft.kind !== kind) {
    data.articleDraft = {
      kind,
      title: article?.title ?? "",
      publicUrl: article?.publicUrl ?? "",
      embedUrl: article?.embedUrl ?? "",
      summary: article?.summary ?? "",
      category: article?.category ?? "",
      courseId: article?.courseId ?? "",
      key: uid(),
      ...(article ? { revision: String(article.revision) } : {}),
    };
    changed();
  }
  const draft = data.articleDraft;
  if (article && !draft.revision) { draft.revision = String(article.revision); changed(); }
  const d = modal(
    article ? "記事の登録情報を編集" : "Notion記事を登録",
    `<p class="muted">${anonymousNotice}</p>${field("title", "タイトル", draft.title, "text", 'required maxlength="120"')}${field("publicUrl", "Notionの公開URL", draft.publicUrl, "url", "required")}<p class="muted">HTTPSの notion.site / notion.so とそのサブドメインが対象です。独自ドメインは未対応です。</p>${textfield("summary", "紹介文（280字まで）", draft.summary, 280)}${field("category", "カテゴリ", draft.category, "text", 'maxlength="40"')}${choice("courseId", "関連する講義", [["", "指定なし"], ...data.imports.flatMap((p) => p.courses).map((c) => [c.id, c.title] as [string, string])], draft.courseId)}<section class="card"><h3>公式の埋め込みURL・コード（任意）</h3><p class="muted">Notionの公開ページで「このページを埋め込む」から取得したiframeコード、またはそのsrcを入力してください。HTML自体は実行しません。通常URLからの変換は行いません。</p>${textfield("embedUrl", "埋め込みコードまたはURL", draft.embedUrl, 4000)}</section><button type="button" id="preview-article">プレビューを確認</button><button type="button" id="refresh-article-revision" class="smallbtn" ${article || draft.recoveredId ? "" : "hidden"}>最新の状態を確認</button><div id="article-current-state" role="status"></div><div id="article-preview"></div><label class="check"><input name="confirmed" type="checkbox" required>元ページ・プレビューがログイン不要で読めることを確認しました</label>`,
    async (form) => {
      if (composing) throw Error("文字変換を確定してください。");
      const title = val(form, "title").trim();
      if (!title || Array.from(title).length > 120)
        throw Error("タイトルは1〜120字です。");
      const body = {
        title,
        publicUrl: notionURL(val(form, "publicUrl")),
        embedUrl: embedSource(val(form, "embedUrl")),
        summary: val(form, "summary").trim(),
        category: val(form, "category").trim(),
        courseId: val(form, "courseId"),
      };
      if (Array.from(body.summary).length > 280)
        throw Error("紹介文は280字以内です。");
      busy++;
      try {
        user = await session();
        const result = article
          ? await api<{ article: Article }>("/articles/" + encodeURIComponent(article.id), "PATCH", body, { "If-Match": draft.revision }).catch(e => {
              if (e instanceof ApiError && e.status === 409) throw Error("記事の状態が変わりました。入力を保持しています。「最新の状態を確認」で変更先の版を確認してください。");
              throw e;
            })
          : await submitNewArticle(draft, body, api, async () => {
              changed();
              if (!(await save())) throw Error("送信前の下書き保存に失敗しました。入力を保持して再試行してください。");
            }).catch(e => {
              if (e instanceof ArticleRecoveryConflict) {
                const trigger = d.querySelector<HTMLButtonElement>("#refresh-article-revision"); if (trigger) trigger.hidden = false;
                const box = d.querySelector<HTMLElement>("#article-current-state"); if (box && e.latest) box.textContent = `最新版（改訂${e.latest.revision}）：${e.latest.title} / ${e.latest.summary} / ${e.latest.category}。入力は保持しています。`;
              }
              throw e;
            });
        data.articleDraft = {};
        changed();
        await save();
        d.close();
        if (article?.visibility === "hidden") navigate("my-articles");
        else navigate("articles/" + result.article.id);
      } finally {
        busy--;
        updates?.activity();
      }
    },
    article ? "変更を保存" : "登録",
    { singleClose: true, className: "article-compose" },
  );
  d.dataset.draft = "true";
  bindArticleRecovery(d, { draft, article, send: api, confirm: message => confirm(message), persist: async () => {
    changed(); if (!(await save())) throw Error("下書きの保存に失敗しました。入力を保持しています。");
  } });
  let articleDirty = false;
  d.addEventListener("input", () => { articleDirty = true; });
  const guardArticle = (event: Event) => {
    if (submitting || (articleDirty && !confirm("記事の入力は下書きに保持します。編集を閉じますか？"))) event.preventDefault();
  };
  d.addEventListener("requestclose", guardArticle);
  d.addEventListener("cancel", guardArticle);
  d.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("[name]").forEach((input) => {
    if (input.name === "confirmed") return;
    input.addEventListener("input", () => {
      draft[input.name] = input.value;
      const confirmed = d.querySelector<HTMLInputElement>("[name=confirmed]");
      if (confirmed) confirmed.checked = false;
      changed();
    });
  });
  bindArticlePreview(d, () => article || (draft.recoveredId ? { id: draft.recoveredId } : undefined));
}
async function deleteOwnArticle(article: Article) {
  if (!confirm("登録した記事情報を削除しますか？Notion本文は削除されません。")) return;
  busy++;
  try { await api("/articles/" + encodeURIComponent(article.id), "DELETE", undefined, { "If-Match": String(article.revision) }); }
  finally { busy--; updates?.activity(); }
}
function reportArticle(article: Article) {
  let dirty = false;
  const d = modal("記事を通報", choice("reason", "理由", [["inappropriate", "不適切"], ["incorrect", "誤情報"], ["broken_link", "リンク不備"], ["other", "その他"]], "inappropriate") + textfield("details", "補足（任意・500字以内）", "", 500), async form => {
    const details = val(form, "details");
    if (Array.from(details).length > 500) throw Error("補足は500字以内です。");
    await session();
    await api("/articles/" + encodeURIComponent(article.id) + "/report", "POST", { reason: val(form, "reason"), details });
    dirty = false; d.close();
    const done = modal("通報を受け付けました", "<p>同じ記事への未確認の通報は重複して作成しません。</p>", undefined, "", { singleClose: true });
    done.focus();
  }, "通報を送信", { singleClose: true, className: "article-report" });
  d.addEventListener("input", () => { dirty = true; });
  const guard = (event: Event) => { if (submitting || (dirty && !confirm("通報の入力を破棄して閉じますか？"))) event.preventDefault(); };
  d.addEventListener("requestclose", guard); d.addEventListener("cancel", guard);
}
const community = new Community({
  page: () => page,
  current: () => pageEpoch.scope(location.hash || "#home", () => location.hash || "#home"),
  action, heading, send: api, session, activity: () => updates?.activity(),
  editArticle: articleForm, deleteArticle: deleteOwnArticle,
});
export { user, setUser, articleFilters, loadArticles, renderArticles, renderArticleDetail, anonymousNotice, community };
