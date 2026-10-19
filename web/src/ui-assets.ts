export function icon(name: string) {
  const paths: Record<string, string> = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    sliders: '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="var(--paper)"/><circle cx="16" cy="12" r="2" fill="var(--paper)"/><circle cx="10" cy="18" r="2" fill="var(--paper)"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    timetable: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
    articles: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
    notes: '<path d="M13 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8M12 12l8-8 2 2-8 8-4 1z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    check: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="m7 12 3 3 7-7"/>',
    color: '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2a3 3 0 0 0 3-3 9 9 0 0 0-9-8z"/><circle cx="7" cy="10" r=".7"/><circle cx="11" cy="7" r=".7"/><circle cx="16" cy="8" r=".7"/>',
    pin: '<path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4zM12 15v7"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.more}</svg>`;
}
const svg = (body: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">${body}</svg>`);
export const backgrounds = [
  { id: 'forest', name: '森', image: svg('<rect width="1200" height="900" fill="#dce8cb"/><path d="M0 500 180 260 360 530 570 220 850 540 1080 300 1200 470V900H0" fill="#9bb99b"/><path d="M0 740 260 440 500 760 820 390 1200 720V900H0" fill="#496d4b"/><path d="M0 900 210 710 460 900 750 640 1050 900" fill="#264437"/>') },
  { id: 'sea', name: '海', image: svg('<rect width="1200" height="900" fill="#d6e8e7"/><path d="M0 350Q300 300 600 360T1200 350V900H0" fill="#8ab6ba"/><path d="M0 500Q300 430 600 510T1200 500V900H0" fill="#6e999d"/><path d="M0 710Q360 550 730 700T1200 660V900H0" fill="#e5dbc0"/>') },
  { id: 'sky', name: '空', image: svg('<defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#bed6e1"/><stop offset="1" stop-color="#e2e9e0"/></linearGradient></defs><rect width="1200" height="900" fill="url(#s)"/><g fill="#f9fbf6"><ellipse cx="270" cy="470" rx="270" ry="90"/><ellipse cx="380" cy="420" rx="150" ry="100"/><ellipse cx="1000" cy="230" rx="250" ry="75"/></g>') },
  { id: 'sunset', name: '夕暮れ', image: svg('<defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#b3b8ca"/><stop offset="1" stop-color="#dfb6ac"/></linearGradient></defs><rect width="1200" height="900" fill="url(#s)"/><circle cx="810" cy="380" r="125" fill="#ffe4b1"/><path d="M0 730Q300 590 630 740T1200 690V900H0" fill="#73817c"/>') },
  { id: 'paper', name: '紙', image: svg('<defs><pattern id="p" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#f3eee2"/><path d="M0 0h14M0 7h14" stroke="#e8e1cf" stroke-width="1"/></pattern></defs><rect width="1200" height="900" fill="url(#p)"/>') },
  { id: 'shape', name: '幾何', image: svg('<rect width="1200" height="900" fill="#e5eddf"/><path d="M0 0 780 900H0" fill="#dddcb8"/><path d="M1200 0 430 900h770" fill="#a9b9aa"/><circle cx="940" cy="230" r="150" fill="#cbd6bb"/>') },
];
export function visibleBackground(data: { background: string; backgroundMode?: string }) {
  if (data.backgroundMode === 'none') return '';
  return backgrounds.find(b => b.id === data.backgroundMode)?.image || data.background;
}
export function namedAuthor(name: string | undefined | null) { return !!name?.trim() && name.trim() !== '匿名ユーザー'; }
export function noteHasContent(note: { text: string; images: unknown[]; checklist: { text: string }[] }) {
  return !!(note.text.trim() || note.images.length || note.checklist.some(c => c.text.trim()));
}
