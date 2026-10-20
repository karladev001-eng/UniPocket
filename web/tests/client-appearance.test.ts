import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { emptyData, validateData, tokyo } from '../src/domain';
import { appearanceCacheKey, applyAppearance, cacheAppearance, modeOf, themeColors } from '../src/appearance';
import { LocalStore, SaveQueue } from '../src/storage';

let cache: Map<string, string>;
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  cache = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());
const cached = () => JSON.parse(cache.get(appearanceCacheKey)!);
async function rawRow() {
  const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('shizudai-pocket', 1); r.onsuccess = () => resolve(r.result); });
  const row = await new Promise<any>(resolve => { const r = db.transaction('state').objectStore('state').get('personal'); r.onsuccess = () => resolve(r.result); });
  db.close(); return row;
}
describe('appearance compatibility and durable saves', () => {
  it('loads a legacy state/export as light while preserving color, images, PDF, memos and drafts', async () => {
    const store = new LocalStore(), data = await store.open();
    delete data.colorMode;
    data.theme = 'rose'; data.backgroundMode = 'custom'; data.background = 'data:image/png;base64,AAAA';
    data.articleDraft = { title: '保持する下書き', key: 'same-idempotency-key' };
    data.addedEvents.push({ id: 'event', title: '予定', start: tokyo('2026-10-20', '09:00'), end: tokyo('2026-10-20', '10:00'), location: '', kind: 'personal', allDay: false });
    data.notes.push({ id: 'note', text: 'メモ', color: 'blue', modified: new Date().toISOString(), images: [{ id: 'image', data: data.background }], checklist: [] });
    data.imports.push({ key: 'pdf', year: 2026, courses: [], events: [], warnings: [], importedAt: new Date().toISOString() });
    data.eventMemos = { event: { text: '今回だけ', modified: new Date().toISOString() } };
    await store.save(data); store.close();
    const next = new LocalStore(), restored = await next.open();
    expect(restored).toEqual(data); expect(modeOf(restored)).toBe('light');
    expect(cached()).toEqual({ colorMode: 'light', theme: 'rose' });
    restored.colorMode = 'dark'; await next.save(restored);
    const exported = JSON.parse(JSON.stringify(restored)); validateData(exported);
    expect(exported).toEqual({ ...data, colorMode: 'dark' }); next.close();
    const reload = new LocalStore(); expect(await reload.open()).toEqual(exported); reload.close();
  });
  it('keeps a failed choice and dirty input; only commits the exact successful snapshot to the first-paint cache', async () => {
    const store = new LocalStore(), data = await store.open(), queue = new SaveQueue(store, () => data);
    data.colorMode = 'dark'; data.articleDraft = { title: 'unsaved draft' }; queue.changed();
    const save = vi.spyOn(store, 'save').mockRejectedValueOnce(Error('quota'));
    await expect(queue.flush()).rejects.toThrow('quota');
    expect(queue.dirty).toBe(true); expect(data.colorMode).toBe('dark'); expect(data.articleDraft.title).toBe('unsaved draft');
    expect(cached().colorMode).toBe('light'); expect(await rawRow()).toBeUndefined();
    save.mockRestore(); await queue.flush();
    expect(queue.dirty).toBe(false); expect(cached().colorMode).toBe('dark');
    expect((await rawRow()).data.articleDraft.title).toBe('unsaved draft');
    data.colorMode = 'light'; queue.changed(); const saving = queue.flush();
    data.colorMode = 'dark'; queue.changed(); await saving;
    expect(queue.dirty).toBe(true); expect(cached().colorMode).toBe('light');
    await queue.flush(); expect(cached().colorMode).toBe('dark'); store.close();
  });
  it('rejects stale writes without caching them and restores the winning appearance on reload', async () => {
    const one = new LocalStore(), two = new LocalStore(), a = await one.open(), b = await two.open();
    a.colorMode = 'dark'; a.theme = 'blue'; await one.save(a);
    b.theme = 'rose'; await expect(two.save(b)).rejects.toThrow('別タブ');
    expect(cached()).toEqual({ colorMode: 'dark', theme: 'blue' });
    const reload = new LocalStore(); expect(await reload.open()).toEqual(a);
    one.close(); two.close(); reload.close();
  });
  it('protects unsupported mode data and ignores unavailable optional cache storage', async () => {
    for (const invalid of ['auto', 'DARK', null, 1, {}]) expect(() => validateData({ ...emptyData(), colorMode: invalid })).toThrow('原本');
    const first = new LocalStore(); await first.open(); first.close();
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('shizudai-pocket', 1); r.onsuccess = () => resolve(r.result); });
    const corrupt = { revision: 7, data: { ...emptyData(), colorMode: 'auto' } };
    await new Promise<void>(resolve => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(corrupt, 'personal'); tx.oncomplete = () => resolve(); }); db.close();
    const protectedStore = new LocalStore(); await expect(protectedStore.open()).rejects.toThrow('原本');
    await expect(protectedStore.save(emptyData())).rejects.toThrow('保護'); expect(await rawRow()).toEqual(corrupt); protectedStore.close();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('localStorage', { setItem: () => { throw Error('denied'); } });
    const store = new LocalStore(), data = await store.open(); data.colorMode = 'dark';
    await expect(store.save(data)).resolves.toBeUndefined(); expect((await rawRow()).data.colorMode).toBe('dark'); store.close();
    expect(() => cacheAppearance(data)).not.toThrow();
  });
});

describe('CSP-compatible first paint before application boot', () => {
  const bootstrap = readFileSync(new URL('../public/appearance-boot.js', import.meta.url), 'utf8');
  function boot(value: string | null, throws = false) {
    const element = { dataset: {} as Record<string, string>, style: {} as Record<string, string> }, meta = { content: '' };
    runInNewContext(bootstrap, { document: { documentElement: element, querySelector: () => meta }, localStorage: { getItem: () => { if (throws) throw Error(); return value; } } });
    return { element, meta };
  }
  it('restores all explicit choices synchronously and rejects malformed hints', () => {
    for (const theme of Object.keys(themeColors)) for (const colorMode of ['light', 'dark']) {
      const { element, meta } = boot(JSON.stringify({ theme, colorMode }));
      expect(element.dataset).toEqual({ theme, colorMode }); expect(element.style.colorScheme).toBe(colorMode);
      expect(meta.content).toBe(colorMode === 'dark' ? '#141b19' : themeColors[theme]);
    }
    for (const value of [null, 'bad json', '{}', '{"theme":"__proto__","colorMode":"dark"}', '{"theme":"blue","colorMode":"auto"}']) expect(boot(value).element.dataset).toEqual({});
    expect(boot(null, true).element.dataset).toEqual({});
  });
  it('uses the authoritative state after async boot and does not depend on OS preferences', () => {
    const { element, meta } = boot('{"theme":"blue","colorMode":"dark"}');
    vi.stubGlobal('document', { documentElement: element, querySelector: () => ({ setAttribute: (_: string, value: string) => { meta.content = value; } }) });
    applyAppearance({ theme: 'rose' });
    expect(element.dataset).toEqual({ theme: 'rose', colorMode: 'light' }); expect(element.style.colorScheme).toBe('light'); expect(element.style.backgroundColor).toBe('');
    expect(meta.content).toBe(themeColors.rose);
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html.indexOf('/appearance-boot.js')).toBeLessThan(html.indexOf('/src/main.ts'));
    expect(html).not.toMatch(/<script>([\s\S]*?)<\/script>/);
    expect(bootstrap).not.toContain('matchMedia');
  });
});

// Evaluate the actual palette definitions. Geometry and final computed browser
// colors are separate QA; this catches unreadable tokens/category combinations.
describe('semantic text contrast', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  function rgb(hex: string) { if (hex.length === 4) hex = '#' + [...hex.slice(1)].map(c => c + c).join(''); return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
  function contrast(a: number[], b: number[]) {
    const luminance = (color: number[]) => color.map(c => { const n = c / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((n, c, i) => n + c * [.2126, .7152, .0722][i], 0);
    const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  for (const theme of ['green', 'blue', 'rose', 'mono']) for (const mode of ['light', 'dark']) it(`${theme}/${mode} reads text, links, badges and colored categories`, () => {
    const tokens: Record<string, string> = {};
    for (const [, selector, body] of rules) {
      const sel = selector.trim(); if (!/^:root(?:\[.*?\])*$/.test(sel)) continue;
      if (sel.includes('data-theme=') && !sel.includes(`data-theme=${theme}`)) continue;
      if (sel.includes('data-color-mode=dark') && mode !== 'dark') continue;
      for (const [, key, value] of body.matchAll(/--([\w-]+):\s*(#[\da-f]{6}|#[\da-f]{3})\b/g)) tokens[key] = value;
    }
    for (const surface of ['paper', 'surface', 'soft', 'light']) for (const ink of ['ink', 'muted', 'accent']) expect(contrast(rgb(tokens[ink]), rgb(tokens[surface])), `${ink}/${surface}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(tokens['badge-ink']), rgb(tokens['badge-bg']))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(tokens['error-ink']), rgb(tokens['error-bg']))).toBeGreaterThanOrEqual(4.5);
    // Worst possible background pixels behind text without a card.
    const paper = rgb(tokens.paper), alpha = mode === 'dark' ? .10 : .08;
    for (const pixel of [0, 255]) {
      const composited = paper.map(c => c * (1 - alpha) + pixel * alpha);
      for (const ink of ['ink', 'muted', 'accent']) expect(contrast(rgb(tokens[ink]), composited), `${ink}/background(${pixel})`).toBeGreaterThanOrEqual(4.5);
    }
    for (const [, selector, body] of rules) {
      if (!selector.includes('.course-color-') || selector.includes(':hover')) continue;
      if (selector.includes('data-color-mode=dark') !== (mode === 'dark')) continue;
      const background = /background:\s*(#[\da-f]{6})/.exec(body)?.[1], color = /color:\s*(#[\da-f]{6})/.exec(body)?.[1];
      if (background && color) expect(contrast(rgb(color), rgb(background)), selector).toBeGreaterThanOrEqual(4.5);
    }
  });
});
