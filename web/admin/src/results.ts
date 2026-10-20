import { el } from './dom';
import type { Results } from './model';

/** A reopened survey must never present an expired history as lifetime zero. */
export function resultsSummary(result: Pick<Results, 'responseCount' | 'resultsComplete' | 'resultsSince'>): HTMLElement {
    const incomplete = result.resultsComplete === false;
    const since = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(result.resultsSince));
    return el('div', {},
        el('div', { class: 'stats' }, el('div', { class: 'stat' }, el('small', {}, incomplete ? '保存期間内の回答数' : '回答数'), el('b', {}, result.responseCount.toLocaleString('ja-JP')))),
        incomplete ? el('p', { class: 'notice', role: 'note' }, `古い集計は保存期限を過ぎたため、${since} 以降の保存期間内の集計です。回答数と選択数の0件は、この期間内の値です。再公開しても過去の集計は復元されません。`) : null);
}
