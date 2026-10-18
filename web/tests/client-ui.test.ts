import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { emptyData, validateData } from '../src/domain';
import { LocalStore } from '../src/storage';
import { backgrounds, visibleBackground, namedAuthor, noteHasContent } from '../src/ui-assets';

describe('UI data compatibility', () => {
  it('preserves the original uploaded background across presets, none, and reopening storage', async () => {
    const store = new LocalStore();
    const data = await store.open();
    data.background = 'data:image/jpeg;base64,original';
    expect(visibleBackground(data)).toBe(data.background);
    for (const preset of backgrounds) {
      data.backgroundMode = preset.id;
      validateData(data);
      expect(visibleBackground(data)).toBe(preset.image);
      expect(preset.image).toMatch(/^data:image\/svg\+xml,/);
    }
    data.backgroundMode = 'none';
    expect(visibleBackground(data)).toBe('');
    await store.save(data);
    store.close();
    const reopened = new LocalStore();
    const restored = await reopened.open();
    expect(restored.backgroundMode).toBe('none');
    restored.backgroundMode = 'custom';
    expect(visibleBackground(restored)).toBe('data:image/jpeg;base64,original');
    reopened.close();
  });
  it('accepts legacy data and rejects unknown background choices', () => {
    const data = emptyData();
    expect(() => validateData(data)).not.toThrow();
    data.backgroundMode = 'unsupported';
    expect(() => validateData(data)).toThrow();
  });
  it('offers author filters only for a non-default display name', () => {
    for (const name of [null, undefined, '', '   ', '匿名ユーザー', ' 匿名ユーザー ']) expect(namedAuthor(name)).toBe(false);
    expect(namedAuthor('学生A')).toBe(true);
  });
  it('does not count blank checklist rows as a new note, but keeps image-only and checklist-only notes', () => {
    const note = { text: ' \n', images: [] as unknown[], checklist: [{ text: '  ' }] };
    expect(noteHasContent(note)).toBe(false);
    note.images.push({ data: 'image' });
    expect(noteHasContent(note)).toBe(true);
    note.images = []; note.checklist[0].text = '課題';
    expect(noteHasContent(note)).toBe(true);
  });
});
