// Keep native form values while presenting the same accessible picker everywhere.
let closePicker: (() => void) | undefined;
let serial = 0;
export function dismissPicker() { closePicker?.(); }
export function enhanceControls(root: ParentNode) {
  root.querySelectorAll<HTMLSelectElement>('select:not([data-enhanced])').forEach(select => {
    select.dataset.enhanced = 'true';
    select.hidden = true;
    const wrapper = document.createElement('div');
    wrapper.className = 'choice-control';
    select.after(wrapper);
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'choice-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const label = select.getAttribute('aria-label') || select.closest('label')?.firstChild?.textContent?.trim() || '選択';
    const sync = () => {
      trigger.textContent = (select.selectedOptions[0]?.textContent || '選択してください') + '　⌄';
      trigger.setAttribute('aria-label', label + ': ' + (select.selectedOptions[0]?.textContent || '未選択'));
      trigger.disabled = select.disabled;
    };
    wrapper.append(trigger);
    select.addEventListener('change', sync);
    sync();
    const open = (last = false) => {
      if (trigger.getAttribute('aria-expanded') === 'true') { closePicker?.(); return; }
      closePicker?.();
      const list = document.createElement('div');
      list.className = 'choice-menu';
      list.id = 'choice-' + ++serial;
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', label);
      trigger.setAttribute('aria-controls', list.id);
      trigger.setAttribute('aria-expanded', 'true');
      const host = select.closest('dialog') || document.body;
      host.append(list);
      const options = [...select.options];
      let active = Math.max(0, select.selectedIndex);
      if (last) active = options.length - 1;
      const buttons = options.map((option, index) => {
        const b = document.createElement('button');
        b.type = 'button'; b.tabIndex = -1;
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', String(option.selected));
        b.disabled = option.disabled;
        b.textContent = (option.selected ? '✓ ' : '') + option.textContent;
        b.onclick = () => {
          select.value = option.value;
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          close(true);
        };
        list.append(b); return b;
      });
      const place = () => {
        const rect = trigger.getBoundingClientRect();
        const width = Math.min(Math.max(rect.width, 220), innerWidth - 24);
        const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
        const up = below < 180 && above > below;
        list.style.width = width + 'px';
        list.style.left = Math.max(12, Math.min(rect.left, innerWidth - width - 12)) + 'px';
        list.style.maxHeight = Math.max(80, Math.min(320, up ? above : below)) + 'px';
        list.style.top = up ? 'auto' : rect.bottom + 5 + 'px';
        list.style.bottom = up ? innerHeight - rect.top + 5 + 'px' : 'auto';
      };
      const outside = (e: Event) => { if (!wrapper.contains(e.target as Node) && !list.contains(e.target as Node)) close(); };
      const focusOut = (e: FocusEvent) => { if (!wrapper.contains(e.target as Node) && !list.contains(e.target as Node)) close(); };
      const close = (restore = false) => {
        list.remove(); trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('focusin', focusOut);
        window.removeEventListener('resize', place);
        document.removeEventListener('scroll', closeOnScroll, true);
        if (closePicker === dismiss) closePicker = undefined;
        if (restore && trigger.isConnected) trigger.focus();
      };
      const dismiss = () => close();
      const closeOnScroll = (e: Event) => { if (!list.contains(e.target as Node)) close(); };
      closePicker = dismiss;
      list.onkeydown = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
        else if (e.key === 'Tab') { close(true); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const step = e.key === 'ArrowUp' ? -1 : 1;
          active = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (active + step + buttons.length) % buttons.length;
          for (let tries = 0; buttons[active]?.disabled && tries < buttons.length; tries++) active = (active + step + buttons.length) % buttons.length;
          buttons[active]?.focus();
        }
      };
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('focusin', focusOut);
      window.addEventListener('resize', place);
      document.addEventListener('scroll', closeOnScroll, true);
      place(); buttons[active]?.focus();
    };
    trigger.onclick = () => open();
    trigger.onkeydown = e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(e.key === 'ArrowUp'); }
    };
  });
  root.querySelectorAll<HTMLInputElement>('input[type=file]:not([data-enhanced])').forEach(input => {
    input.dataset.enhanced = 'true';
    if (input.dataset.toolbar) return;
    input.classList.add('file-native');
    input.tabIndex = -1;
    const wrapper = document.createElement('div'); wrapper.className = 'file-control';
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = input.accept.includes('pdf') ? 'PDFを選ぶ' : '画像を選ぶ';
    button.onclick = () => input.click();
    const output = document.createElement('span'); output.className = 'file-name muted'; output.textContent = '選択されていません';
    input.after(wrapper); wrapper.append(button, output);
    input.addEventListener('change', () => { output.textContent = [...input.files ?? []].map(f => f.name).join('、') || '選択されていません'; });
    input.addEventListener('invalid', () => { button.focus(); });
  });
}
