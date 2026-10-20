import { api, embedSource, notionURL, type Article } from './api';
import { escapeHTML } from './community';

// The online/public checks belong to the actual click handler, including the
// boundary after its asynchronous public-status request and before DOM insertion.
export function bindArticlePreview(dialog: HTMLDialogElement, article?: Article, send = api) {
  dialog.querySelector<HTMLButtonElement>('#preview-article')!.onclick = async () => {
    try {
      if (!navigator.onLine) throw Error('オフラインでは新しいNotionプレビューを開けません。');
      if (article) {
        if (article.visibility === 'hidden') throw Error('非表示の記事はプレビューを開けません。登録情報の編集・削除はできます。');
        await send('/articles/' + encodeURIComponent(article.id));
      }
      if (!dialog.open || !dialog.isConnected) return;
      const form = new FormData(dialog.querySelector('form')!);
      const publicURL = notionURL(String(form.get('publicUrl') ?? ''));
      const embed = embedSource(String(form.get('embedUrl') ?? ''));
      const content = `<div class="notice"><p>実際の公開状態はご本人が確認してください。</p><a href="${escapeHTML(publicURL)}" target="_blank" rel="noopener noreferrer">元ページを開いて確認 ↗</a></div>${embed ? `<iframe title="Notion記事の投稿前プレビュー" class="article-frame" src="${escapeHTML(embed)}" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>` : '<div class="empty">埋め込みURLが未入力です。元ページを開いて確認できます。</div>'}`;
      if (!navigator.onLine) throw Error('オフラインでは新しいNotionプレビューを開けません。');
      dialog.querySelector('#article-preview')!.innerHTML = content;
    } catch (error) {
      const box = dialog.querySelector<HTMLElement>('.modal-error')!;
      box.hidden = false;
      box.textContent = error instanceof Error ? error.message : String(error);
    }
  };
}
