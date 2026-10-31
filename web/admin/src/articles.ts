import { articlePreviewControl } from "./article-confirmation";
import {
  ArticleEditor,
  articleErrors,
  articleFields,
  type ArticleDraft,
} from "./article-editor";
import { adminBadgeNode, ADMIN_NAME } from "../../src/author-badge";
import { articlePreviewSource } from "../../src/article-preview";
import { errorMessage, safeLink, type Article, type Report } from "./model";
import { el, button, field, table } from "./dom";
import { AdminPages, VisibilityOperation, reportArticle } from "./moderation";
import {
  authBanner,
  confirmAction,
  dialog,
  empty,
  formatDate,
  heading,
  main,
  notify,
  openDialog,
  showError,
  taskButton,
} from "./shell";
import { client, navigation, ui } from "./state";
// Articles screen: list and reports, article detail with hide/restore, and the admin article editor.
export async function articlePage(token = ui.generation): Promise<void> {
  if (token !== ui.generation || ui.section !== "articles") return;
  heading(
    "記事",
    button("＋ 運営記事", () => openArticleEditor(), "linebtn"),
  );
  const articles = new AdminPages<Article>("articles", client.send);
  const reports = new AdminPages<Report>("reports", client.send);
  const listing = el("div"),
    filters = el("form", { class: "filters" });
  const search = el("input", {
    type: "search",
    placeholder: "題名・投稿者・カテゴリ",
    "aria-label": "題名・投稿者・カテゴリで検索",
    maxlength: 200,
  });
  const visibility = el(
    "select",
    { "aria-label": "公開状態" },
    ...[
      ["", "すべての状態"],
      ["published", "公開"],
      ["hidden", "非表示"],
      ["deleted", "作者削除"],
    ].map(([value, text]) => el("option", { value }, text)),
  );
  const reviewed = el(
    "select",
    { "aria-label": "通報の確認状態" },
    el("option", { value: "pending" }, "未確認"),
    el("option", { value: "reviewed" }, "確認済み"),
    el("option", { value: "" }, "すべて"),
  );
  const articleTab = button(
      "記事一覧",
      () => {
        ui.reportTab = false;
        void refresh();
      },
      "tab",
    ),
    reportsTab = button(
      "通報",
      () => {
        ui.reportTab = true;
        void refresh();
      },
      "tab",
    );
  const progress = el("p", { role: "status", class: "muted" });
  const more = button("さらに読み込む", () => void refresh(true));
  let filtersForReports: boolean | undefined;
  let requestEpoch = 0;
  const current = () => token === ui.generation && ui.section === "articles";
  async function refresh(append = false): Promise<void> {
    const epoch = ++requestEpoch,
      viewingReports = ui.reportTab;
    const pages = viewingReports ? reports : articles;
    progress.textContent = "読み込み中…";
    more.disabled = true;
    try {
      const pending = append
        ? pages.more()
        : viewingReports
          ? reports.reset({ status: reviewed.value })
          : articles.reset({
              q: search.value.trim(),
              visibility: visibility.value,
            });
      if (!append) renderRows();
      const applied = await pending;
      if (
        !current() ||
        epoch !== requestEpoch ||
        viewingReports !== ui.reportTab ||
        !applied
      )
        return;
      renderRows();
      progress.textContent = `${pages.items.length}件を表示${pages.nextCursor ? "・続きがあります" : ""}`;
    } catch (error) {
      if (!current() || epoch !== requestEpoch) return;
      progress.replaceChildren(
        el("span", { role: "alert" }, errorMessage(error)),
        button("再試行", () => void refresh(append)),
      );
      if (!client.authorized) authBanner();
    } finally {
      if (current() && epoch === requestEpoch) {
        more.disabled = false;
        more.hidden = !pages.nextCursor;
      }
    }
  }
  function renderRows(): void {
    articleTab.setAttribute("aria-pressed", String(!ui.reportTab));
    reportsTab.setAttribute("aria-pressed", String(ui.reportTab));
    if (filtersForReports !== ui.reportTab) {
      filters.replaceChildren(
        ...(ui.reportTab
          ? [reviewed]
          : [
              search,
              visibility,
              el("button", { type: "submit", class: "linebtn" }, "検索"),
            ]),
      );
      filtersForReports = ui.reportTab;
    }
    if (ui.reportTab) {
      const items = reports.items;
      listing.replaceChildren(
        items.length
          ? table(
              ["記事 / 通報", "確認"],
              items.map((r) => [
                el(
                  "div",
                  {},
                  taskButton(
                    r.articleTitle || "記事",
                    async () => {
                      const article = await reportArticle(
                        r.articleId,
                        client.send,
                      );
                      if (current()) articleDetail(article);
                    },
                    "textbutton",
                  ),
                  el(
                    "small",
                    {},
                    reportReason(r.reason),
                    " · ",
                    formatDate(r.createdAt),
                  ),
                  el("p", { class: "bodycopy" }, r.details),
                ),
                taskButton(
                  r.status === "pending" ? "確認済みにする" : "未確認に戻す",
                  async () => {
                    await client.send(
                      "/reports/" + encodeURIComponent(r.id),
                      "PATCH",
                      {
                        revision: r.revision,
                        status: r.status === "pending" ? "reviewed" : "pending",
                      },
                    );
                    await refresh();
                  },
                ),
              ]),
            )
          : reports.loading
            ? el("div")
            : empty("該当する通報はありません。"),
      );
    } else {
      const items = articles.items;
      listing.replaceChildren(
        items.length
          ? table(
              ["題名 / 投稿者", "公開状態", "閲覧 / ブックマーク"],
              items.map((a) => [
                el(
                  "div",
                  {},
                  button(a.title, () => articleDetail(a), "textbutton"),
                  el(
                    "small",
                    {},
                    a.authorName,
                    adminBadgeNode(a.authorKind),
                    " · ",
                    a.category || "未分類",
                  ),
                ),
                el("span", { class: "tag" }, articleStatus(a)),
                `${a.viewCount} / ${a.bookmarkCount}`,
              ]),
            )
          : articles.loading
            ? el("div")
            : empty("該当する記事はありません。"),
      );
    }
    more.hidden = !(ui.reportTab ? reports.nextCursor : articles.nextCursor);
  }
  filters.addEventListener("submit", (event) => {
    event.preventDefault();
    void refresh();
  });
  [visibility, reviewed].forEach((input) =>
    input.addEventListener("change", () => void refresh()),
  );
  main.append(
    el("div", { class: "tabs" }, articleTab, reportsTab),
    filters,
    progress,
    listing,
    more,
    el(
      "details",
      {},
      el("summary", {}, "記事管理について"),
      el(
        "p",
        {},
        "題名・投稿者・カテゴリの検索と公開状態の絞り込みは全件を対象にします。一度に50件ずつ表示します。記事は登録後すぐに公開されます。本文は元のNotionページで管理されます。ここでの非表示はNotionページ自体を非公開にしません。",
      ),
    ),
  );
  await refresh();
}
function openArticleEditor(item?: Article): void {
  if (
    (ui.editor?.hasInputToLose || ui.articleEditor?.hasInputToLose) &&
    !window.confirm("保存していない入力があります。破棄して編集を開きますか？")
  )
    return;
  ++ui.generation;
  ui.articleEditor = new ArticleEditor(item);
  renderArticleEditor();
}
function articlePreview(input: ArticleDraft): HTMLElement {
  const source = articlePreviewSource(input.publicUrl, input.embedUrl);
  return el(
    "div",
    { class: "preview" },
    el("small", {}, "一般アプリでの表示"),
    el("h3", {}, input.title),
    el("p", { class: "bodycopy" }, input.summary),
    el("p", {}, ADMIN_NAME, adminBadgeNode("admin")),
    el("p", {}, input.category || "未分類"),
    el("p", { class: "notice" }, source.warning),
    el(
      "a",
      {
        href: source.publicURL,
        target: "_blank",
        rel: "noopener noreferrer",
        class: "quietlink",
      },
      "元ページを開いて確認 ↗",
    ),
    source.embed
      ? navigator.onLine
        ? el("iframe", {
            title: "Notion記事の投稿前プレビュー",
            class: "article-frame",
            src: source.embed,
            sandbox:
              "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox",
            referrerpolicy: "strict-origin-when-cross-origin",
          })
        : el(
            "p",
            {},
            "オフラインではプレビューを読み込めません。接続後に確認してください。",
          )
      : el(
          "p",
          {},
          "埋め込みURLが未入力です。元ページを開いて確認してください。",
        ),
  );
}
function renderArticleEditor(): void {
  const state = ui.articleEditor!;
  heading(
    state.item ? "運営記事を編集" : "運営記事を投稿",
    button("一覧へ", () => void navigation.go("articles")),
  );
  const form = el("form", {
    class: "editor",
    novalidate: true,
    onsubmit: (event: Event) => event.preventDefault(),
  });
  const errors = new Map<string, HTMLElement>();
  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  form.append(
    el("div", {
      id: "form-error",
      class: "notice error",
      role: "alert",
      tabindex: -1,
      hidden: true,
    }),
    el("p", {}, "投稿者：", ADMIN_NAME, adminBadgeNode("admin")),
    el(
      "p",
      { class: "muted" },
      "Notion本文はNotionで作成・編集してください。ここで登録した記事は一般公開されます。",
    ),
  );
  if (state.item)
    form.append(
      el(
        "p",
        {},
        `改訂 ${state.item.revision} · ${articleStatus(state.item)}。登録情報の変更では公開状態を変えません。`,
      ),
    );
  if (state.latest) {
    const latest = state.latest;
    form.append(
      el(
        "section",
        { class: "notice" },
        el("h2", {}, "最新版と現在の入力を比較"),
        el(
          "p",
          {},
          `最新版：改訂 ${latest.revision} · ${articleStatus(latest)}`,
        ),
        el(
          "p",
          { class: "bodycopy" },
          JSON.stringify(
            {
              title: latest.title,
              publicUrl: latest.publicUrl,
              summary: latest.summary,
              category: latest.category,
              courseId: latest.courseId,
              embedUrl: latest.embedUrl,
            },
            null,
            2,
          ),
        ),
        button("変更した項目を保持して最新版を適用", () => {
          state.rebase();
          renderArticleEditor();
          notify(
            "入力を保持しました。プレビューと反映内容をもう一度確認してください。",
          );
        }),
      ),
    );
  }
  const optional = el(
    "details",
    {},
    el("summary", {}, "埋め込み・カテゴリ・講義（任意）"),
  );
  const labels = {
    title: "題名（必須・120文字まで）",
    publicUrl: "Notionの公開HTTPS URL（必須）",
    summary: "紹介（任意・280文字まで）",
    category: "カテゴリ（任意・60文字まで）",
    courseId: "講義ID（任意・120文字まで）",
    embedUrl: "公式埋め込みURL・iframeコード（任意）",
  };
  for (const name of articleFields) {
    const input =
      name === "summary" || name === "embedUrl"
        ? el("textarea", { rows: name === "embedUrl" ? 3 : 4 })
        : el("input", { type: name === "publicUrl" ? "url" : "text" });
    input.value = state.input[name];
    input.name = name;
    input.id = "admin-article-" + name;
    if (name === "title" || name === "publicUrl") input.required = true;
    const limit = {
      title: 120,
      publicUrl: 2048,
      summary: 280,
      category: 60,
      courseId: 120,
      embedUrl: 4000,
    }[name];
    input.maxLength = limit;
    const error = el("small", {
      id: input.id + "-error",
      class: "field-error",
      hidden: true,
    });
    input.setAttribute("aria-describedby", error.id);
    input.addEventListener("input", () => {
      state.input[name] = input.value;
      input.removeAttribute("aria-invalid");
      error.hidden = true;
    });
    errors.set(name, error);
    inputs.set(name, input);
    (["category", "courseId", "embedUrl"].includes(name)
      ? optional
      : form
    ).append(field(labels[name], input), error);
  }
  form.append(optional);
  form.append(
    el(
      "p",
      { class: "muted" },
      "公開URLは notion.site / notion.so のHTTPSに対応。埋め込みはNotionの「このページを埋め込む」から取得してください。HTML自体は実行しません。",
    ),
  );
  const check = el("input", { type: "checkbox" });
  const preview = articlePreviewControl(state, (confirmation) => {
    const target = confirmation.input;
    const problems = articleErrors(target);
    for (const [name, box] of errors) {
      const problem = problems[name as keyof ArticleDraft];
      box.hidden = !problem;
      box.textContent = problem || "";
      if (problem) {
        inputs.get(name)!.setAttribute("aria-invalid", "true");
        if (["category", "courseId", "embedUrl"].includes(name))
          optional.open = true;
      }
    }
    if (Object.keys(problems).length) {
      inputs.get(Object.keys(problems)[0])?.focus();
      return;
    }
    check.checked = false;
    const body = el(
      "div",
      {},
      confirmation.recovery
        ? el(
            "p",
            { class: "notice" },
            "以下は前回送信した内容です。再送で保存結果を確認します。未保存だった場合は、この前回の内容で公開・変更を完了します。現在入力している変更は送信しません。結果の確認後に保存内容と比較し、変更は別のプレビューで反映してください。",
          )
        : null,
      articlePreview(target),
      el(
        "label",
        { class: "check" },
        check,
        "元ページ・プレビューがログイン不要で読めることを確認しました",
      ),
      el(
        "p",
        { class: "muted" },
        confirmation.recovery
          ? "前回の送信内容だけを同じ送信キーで再確認します。"
          : state.item
            ? "登録情報の変更が一般の表示に反映されます。非表示の記事は非表示のままです。"
            : "この内容を一般公開します。",
      ),
    );
    openDialog(
      confirmation.recovery
        ? "前回の送信内容と結果を確認"
        : state.item
          ? "変更を反映しますか？"
          : "運営記事を公開しますか？",
      body,
      [
        taskButton(
          confirmation.recovery
            ? "前回の内容で送信結果を確認"
            : state.item
              ? "変更を反映する"
              : "公開する",
          async () => {
            if (!check.checked) {
              check.setCustomValidity(
                "公開表示を確認してチェックしてください。",
              );
              check.reportValidity();
              check.setCustomValidity("");
              check.focus();
              return;
            }
            const editing = !!state.item;
            try {
              await preview.submit(confirmation, client.send);
            } catch (error) {
              if (
                error instanceof Error &&
                "articleId" in error &&
                typeof error.articleId === "string"
              ) {
                const box = dialog.querySelector("#dialog-error")!;
                box.replaceChildren(
                  el("p", {}, error.message),
                  taskButton("登録済みの記事を確認", async () => {
                    const existing = await reportArticle(
                      error.articleId as string,
                      client.send,
                    );
                    dialog.close();
                    articleDetail(existing);
                  }),
                );
                (box as HTMLElement).hidden = false;
                return;
              }
              dialog.close();
              if (state.latest) renderArticleEditor();
              throw error;
            }
            ui.articleEditor = undefined;
            dialog.close();
            await articlePage();
            notify(
              editing ? "運営記事を保存しました。" : "運営記事を公開しました。",
            );
          },
          "action",
        ),
      ],
    );
  });
  form.append(preview.notice);
  form.append(
    el(
      "div",
      { class: "editorfooter" },
      preview.button,
      state.item
        ? taskButton("最新版と比較", async () => {
            await state.refresh(client.send);
            renderArticleEditor();
          })
        : null,
    ),
  );
  main.append(form);
}
function reportReason(reason: string): string {
  return (
    (
      {
        inappropriate: "不適切",
        incorrect: "誤情報",
        broken_link: "リンク不備",
        other: "その他",
      } as Record<string, string>
    )[reason] || reason
  );
}
function articleStatus(a: Article): string {
  return a.visibility === "hidden"
    ? "非表示"
    : a.visibility === "deleted"
      ? "作者削除"
      : "公開";
}
function articleDetail(a: Article): void {
  const reason = el("textarea", {
    maxlength: 500,
    rows: 3,
    value: a.hiddenReason || "",
    required: true,
  });
  const body = el(
    "div",
    {},
    el("h3", {}, a.title),
    el(
      "p",
      {},
      a.authorName,
      adminBadgeNode(a.authorKind),
      ` · ${a.category || "未分類"}`,
    ),
    el("p", {}, `閲覧 ${a.viewCount} / 現在のブックマーク ${a.bookmarkCount}`),
    el("p", {}, articleStatus(a)),
    el("p", { class: "bodycopy" }, a.hiddenReason),
    safeLink(a.publicUrl)
      ? el(
          "a",
          {
            href: safeLink(a.publicUrl),
            target: "_blank",
            rel: "noopener noreferrer",
            class: "quietlink",
          },
          "元のNotionページ ↗",
        )
      : null,
  );
  if (a.visibility === "deleted") {
    body.append(el("p", {}, "作者が削除した記事は再公開できません。"));
    openDialog("記事の詳細", body);
    return;
  }
  if (a.authorKind === "admin")
    body.append(
      button("登録情報を編集", () => {
        dialog.close();
        openArticleEditor(a);
      }),
    );
  if (a.visibility === "published")
    body.append(field("非表示の理由（作者にも表示）", reason, "1〜500文字"));
  openDialog("記事の詳細", body, [
    button(
      a.visibility === "published" ? "非表示の確認へ" : "再公開の確認へ",
      () => {
        if (a.visibility === "published" && !reason.value.trim()) {
          reason.setCustomValidity("非表示の理由を入力してください。");
          reason.reportValidity();
          reason.setCustomValidity("");
          reason.focus();
          return;
        }
        const hidden = a.visibility === "published",
          text = reason.value.trim();
        let operation: VisibilityOperation;
        try {
          operation = new VisibilityOperation(
            a.id,
            a.revision,
            hidden ? "hidden" : "published",
            text,
          );
        } catch (error) {
          showError(error);
          return;
        }
        dialog.close();
        confirmAction(
          hidden
            ? "この記事を非表示にしますか？"
            : "この記事を再公開しますか？",
          el(
            "div",
            {},
            el("h3", {}, a.title),
            el("p", {}, a.authorName, adminBadgeNode(a.authorKind)),
            el("small", {}, `対象の改訂 ${operation.input.revision}`),
            hidden
              ? el("p", { class: "bodycopy" }, operation.input.reason)
              : el("p", {}, "一般の一覧と詳細に再び表示されます。"),
          ),
          hidden ? "非表示にする" : "再公開する",
          async () => {
            await operation.submit(client.send);
            await articlePage();
            notify(
              hidden ? "記事を非表示にしました。" : "記事を再公開しました。",
            );
          },
        );
      },
      a.visibility === "published" ? "danger" : "action",
    ),
  ]);
}
