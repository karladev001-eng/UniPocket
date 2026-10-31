import { dayKey, tokyo } from "./domain";
import { minutePixels } from "./calendar-presentation";

// Move the one marker instead of rebuilding the calendar: open editors, focus and
// both scroll axes survive the Tokyo midnight boundary.
export function refreshCurrentTime(root: HTMLElement, now: number) {
  const today = dayKey(new Date(now));
  const target = [...root.querySelectorAll<HTMLElement>(".timeline-day")].find(
    (column) => column.dataset.day === today,
  );
  let line = root.querySelector<HTMLElement>(".now-line");
  root
    .querySelectorAll<HTMLElement>(".timeline-date")
    .forEach((heading) =>
      heading.classList.toggle("today", heading.dataset.day === today),
    );
  if (!target) {
    line?.remove();
    return;
  }
  if (!line) {
    line = root.ownerDocument.createElement("div");
    line.className = "now-line";
    line.setAttribute("aria-label", "現在時刻");
  }
  line.hidden = false;
  line.style.top =
    ((now - Date.parse(tokyo(today))) / 60000) * minutePixels + "px";
  if (line.parentElement !== target) target.append(line);
}
