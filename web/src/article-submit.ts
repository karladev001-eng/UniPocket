import { ApiError, type Article } from "./api";

type ArticleBody = Pick<Article, "title" | "publicUrl" | "embedUrl" | "summary" | "category" | "courseId">;
type Send = <T>(path: string, method: string, body: unknown, headers?: Record<string, string>) => Promise<T>;
export class ArticleRecoveryConflict extends Error {
  constructor(public latest?: Article) { super('登録済みの記事に別の更新があります。入力は保持しています。「最新の状態を確認」で比較してから変更を適用してください。'); }
}
export function articleChanges(original: ArticleBody, desired: ArticleBody): Partial<ArticleBody> {
  return Object.fromEntries(Object.entries(desired).filter(([key, value]) => value !== original[key as keyof ArticleBody]));
}
// The original create always starts at revision 1. A replay may return a newer
// row: that is evidence of another writer, never permission to overwrite it.
export async function submitNewArticle(
  draft: Record<string, string>, body: ArticleBody, send: Send, persist: () => Promise<void>,
): Promise<{ article: Article }> {
  draft.pendingBody ??= JSON.stringify(body);
  await persist();
  const original = JSON.parse(draft.pendingBody) as ArticleBody;
  let result: { article: Article };
  if (!draft.recoveredId) {
    try {
      result = await send('/articles', 'POST', original, { 'Idempotency-Key': draft.key });
    } catch (e) {
      if (e instanceof ApiError && ([400, 413, 415].includes(e.status) || e.code === 'duplicate_url')) { delete draft.pendingBody; await persist(); }
      throw e;
    }
    draft.recoveredId = result.article.id;
    await persist();
    if (result.article.revision !== 1) throw new ArticleRecoveryConflict(result.article);
    const changes = articleChanges(original, body);
    if (!Object.keys(changes).length) return result;
  }
  const changes = articleChanges(original, body);
  if (!Object.keys(changes).length) {
    const latest = (await send<{ articles: Article[] }>('/my/articles', 'GET', undefined)).articles.find(a => a.id === draft.recoveredId);
    if (!latest) throw new ArticleRecoveryConflict();
    if (latest.revision !== Number(draft.applyRevision || 1)) throw new ArticleRecoveryConflict(latest);
    return { article: latest };
  }
  try {
    // Even recovery followed immediately by PATCH uses the known creation CAS.
    // Only an explicit user comparison may advance this revision.
    return await send('/articles/' + encodeURIComponent(draft.recoveredId), 'PATCH', changes, { 'If-Match': draft.applyRevision || '1' });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) throw new ArticleRecoveryConflict();
    throw e;
  }
}

/** Bound by the product form; display latest values before explicit user rebase. */
export function bindArticleRecovery(dialog: HTMLDialogElement, options: {
  draft: Record<string, string>; article?: Article; send: Send;
  confirm: (message: string) => boolean; persist: () => Promise<void>;
}): void {
  const trigger = dialog.querySelector<HTMLButtonElement>('#refresh-article-revision');
  const box = dialog.querySelector<HTMLElement>('#article-current-state');
  if (!trigger || !box) return;
  const { draft, article } = options;
  trigger.onclick = async () => {
    trigger.disabled = true;
    try {
      const id = article?.id || draft.recoveredId;
      if (!id) throw Error('登録の再試行で保存先を確認してください。入力は保持しています。');
      const latest = (await options.send<{ articles: Article[] }>('/my/articles', 'GET', undefined)).articles.find(a => a.id === id);
      if (!dialog.open || !dialog.isConnected) return;
      if (!latest) throw Error('記事は削除されたか、取得できません。現在の入力は保持しています。');
      box.textContent = `最新版（改訂${latest.revision}）：${latest.title} / ${latest.summary} / ${latest.category} / ${latest.publicUrl} / ${latest.embedUrl || '埋め込みなし'} / ${latest.courseId || '講義なし'}（${latest.visibility === 'hidden' ? '非表示：' + latest.hiddenReason : '公開中'}）`;
      if (options.confirm(article ? '最新版を表示しました。現在の入力でこの版を変更しますか？' : '最新版を表示しました。登録時から自分が変更した項目だけを、この版へ適用できるようにしますか？')) {
        draft[article ? 'revision' : 'applyRevision'] = String(latest.revision);
        if (article) article.visibility = latest.visibility;
        await options.persist();
      }
    } catch (error) { box.textContent = error instanceof Error ? error.message : String(error); }
    finally { trigger.disabled = false; }
  };
}
