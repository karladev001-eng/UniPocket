import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { emptyData, validateData, install, events, tokyo, type CampusEvent, type Plan } from '../src/domain';
import { setEventMemo, eventMemoText } from '../src/event-memos';
import { LocalStore, SaveQueue } from '../src/storage';
import { MapViewport } from '../src/map-viewport';
import { appendUnique } from '../src/article-request';

const occurrence = (id: string): CampusEvent => ({ id, title: '授業', start: tokyo('2026-10-20', '09:00'), end: tokyo('2026-10-20', '10:00'), location: '共12', kind: 'lecture', allDay: false });
const plan = (entries: CampusEvent[]): Plan => ({ key: 'same-pdf', year: 2026, courses: [], events: entries, warnings: [], importedAt: new Date().toISOString() });

describe('exact occurrence memos and old data', () => {
  it('reads old data as empty, validates 5000 plain characters and only removes the explicitly cleared memo', () => {
    const data = emptyData();
    expect(data.eventMemos).toBeUndefined();
    expect(eventMemoText(data, 'lesson-1')).toBe('');
    expect(() => validateData(data)).not.toThrow();
    const text = '<script>alert(1)</script>\n'.padEnd(5000, 'a');
    expect(text.length).toBe(5000);
    setEventMemo(data, 'lesson-1', text);
    setEventMemo(data, 'lesson-2', '次の回');
    expect(() => validateData(data)).not.toThrow();
    expect(() => setEventMemo(data, 'lesson-1', 'a'.repeat(5001))).toThrow('5000');
    expect(eventMemoText(data, 'lesson-1')).toBe(text);
    setEventMemo(data, 'lesson-1', '');
    expect(Object.hasOwn(data.eventMemos!, 'lesson-1')).toBe(false);
    expect(eventMemoText(data, 'lesson-2')).toBe('次の回');
    for (const invalid of [null, [], { x: { text: 'a'.repeat(5001), modified: new Date().toISOString() } }, { x: { text: 'ok', modified: 'bad' } }]) {
      expect(() => validateData({ ...data, eventMemos: invalid })).toThrow('予定メモ');
    }
  });
  it('preserves exact IDs through individual edits, PDF replacement, cancellation and export without copying to a new ID', () => {
    let data = emptyData();
    data.imports = [plan([occurrence('lesson-1'), occurrence('lesson-2')])];
    data.notes.push({ id: 'normal-note', text: '通常メモ', modified: new Date().toISOString(), color: 'green', images: [], checklist: [] });
    setEventMemo(data, 'lesson-1', 'この回だけのメモ');
    data.occurrenceEdits.push({ id: 'lesson-1', title: '個人タイトル', start: tokyo('2026-10-20', '11:00'), end: tokyo('2026-10-20', '12:00') });
    expect(eventMemoText(data, events(data).find(e => e.id === 'lesson-1')!.id)).toBe('この回だけのメモ');
    data = install(data, plan([occurrence('lesson-1'), occurrence('new-id')]), { 'lesson-1': 'pdf' });
    expect(eventMemoText(data, 'lesson-1')).toBe('この回だけのメモ');
    expect(eventMemoText(data, 'new-id')).toBe('');
    data = install(data, plan([]), { 'lesson-1': 'pdf' });
    data.occurrenceEdits.push({ id: 'lesson-1', cancelled: true });
    data.addedEvents = [];
    const exported = JSON.parse(JSON.stringify(data));
    expect(exported.eventMemos['lesson-1'].text).toBe('この回だけのメモ');
    expect(exported.notes[0].text).toBe('通常メモ');
    expect(exported.imports[0].events).toEqual([]);
  });
  it('keeps uncommitted memo input for export on another-tab conflict and never overwrites the winning data', async () => {
    const winner = new LocalStore(), stale = new LocalStore();
    const winningData = await winner.open(), current = await stale.open();
    setEventMemo(winningData, 'conflict', '別タブの保存');
    await winner.save(winningData);
    setEventMemo(current, 'conflict', '保持する入力');
    const queue = new SaveQueue(stale, () => current); queue.changed();
    await expect(queue.flush()).rejects.toThrow('別タブ');
    expect(queue.dirty).toBe(true);
    expect(JSON.parse(JSON.stringify(current)).eventMemos.conflict.text).toBe('保持する入力');
    await expect(queue.flush()).rejects.toThrow('別タブ');
    const reader = new LocalStore();
    expect(eventMemoText(await reader.open(), 'conflict')).toBe('別タブの保存');
    winner.close(); stale.close(); reader.close();
  });
  it('reopens saved memos and preserves them through subsequent ordinary note saves', async () => {
    const first = new LocalStore(), data = await first.open();
    setEventMemo(data, 'retained', '予定メモ'); await first.save(data); first.close();
    const next = new LocalStore(), restored = await next.open();
    restored.notes.push({ id: 'normal-new', text: '通常メモ編集', modified: new Date().toISOString(), color: 'green', images: [], checklist: [] });
    await next.save(restored); next.close();
    const last = new LocalStore();
    expect(eventMemoText(await last.open(), 'retained')).toBe('予定メモ'); last.close();
  });
});

describe('map movement and ranking pagination boundaries', () => {
  it('starts at 1.6, bounds pinch/button zoom to 1–4 and resets all map bounds', () => {
    const viewport = new MapViewport([10, 20, 1000, 800]);
    expect(viewport.zoom).toBe(1.6);
    viewport.scale(100); expect(viewport.zoom).toBe(4);
    viewport.center([510, 420]);
    expect(viewport.box).toEqual([385, 320, 250, 200]);
    viewport.pan(100000, -100000, 400, 500);
    expect(viewport.box).toEqual([10, 620, 250, 200]);
    viewport.scale(-1); expect(viewport.zoom).toBe(1);
    viewport.reset(); expect(viewport.box).toEqual([10, 20, 1000, 800]);
  });
  it('deduplicates rank shifts across 50+ cards while preserving visible objects and order after bookmark changes', () => {
    const first = Array.from({ length: 20 }, (_, i) => ({ id: String(i), bookmarked: false }));
    first[0].bookmarked = true;
    const second = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 18), bookmarked: false }));
    const last = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 36), bookmarked: false }));
    const all = appendUnique(appendUnique(first, second), last);
    expect(all.map(a => a.id)).toEqual(Array.from({ length: 56 }, (_, i) => String(i)));
    expect(all[0]).toBe(first[0]); expect(all[0].bookmarked).toBe(true);
    expect(appendUnique([], [first[0], first[0]])).toEqual([first[0]]);
  });
});
