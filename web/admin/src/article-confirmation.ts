import { button, el } from './dom';
import { ArticleEditor, type ArticleConfirmation } from './article-editor';
import type { Sender } from './model';
/** Refresh the mounted controls after a failed request without replacing inputs. */
export function articlePreviewControl(state: ArticleEditor, open: (confirmation: ArticleConfirmation) => void) {
    const notice = el('p', { class: 'notice', hidden: true }, '前回の送信結果が未確認です。前回の送信内容を確認します。現在の入力は保持し、その変更の反映は結果確認後に別のプレビューで行います。');
    const control = button('', () => open(state.confirmation()));
    const refresh = () => {
        control.textContent = state.pending ? '前回の送信結果を確認' : state.item ? '変更をプレビュー' : '公開プレビューへ';
        control.disabled = !!state.latest;
        notice.hidden = !state.pending;
    };
    refresh();
    const submit = async (confirmation: ArticleConfirmation, send: Sender) => {
        try { return await state.submitConfirmed(confirmation, send); }
        finally { refresh(); }
    };
    return { button: control, notice, refresh, submit };
}
