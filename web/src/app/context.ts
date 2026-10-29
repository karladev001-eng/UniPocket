// Shared application context: shell elements, personal data, cross-screen view
// state, the data-action registry and render/navigate. Screens import from here
// rather than from main.ts, which keeps the module graph acyclic.
import { ViewEpoch } from "../article-request";
import {
  type CalendarMode,
  initialCalendarMode,
} from "../calendar-presentation";
import { type Data, emptyData, dayKey, weekDay } from "../domain";
import { LocalStore, SaveQueue } from "../storage";
import type { installUpdates } from "../update";
export const root = document.querySelector<HTMLDivElement>("#app")!;
export let page = document.createElement("main"),
  status: HTMLElement,
  errorBox: HTMLElement;
// Binds the shell elements after main.ts renders the shell markup.
export function attachShell() {
  page = root.querySelector("#page")!;
  status = root.querySelector("#save-status")!;
  errorBox = root.querySelector("#error")!;
}
export let data: Data = emptyData(),
  composing = false,
  frozen = false,
  updates: ReturnType<typeof installUpdates>;
export function setData(next: Data) {
  data = next;
}
export function setComposing(value: boolean) {
  composing = value;
}
export function setFrozen(value: boolean) {
  frozen = value;
}
export function setUpdates(value: typeof updates) {
  updates = value;
}
const today = dayKey();
// Date and calendar mode shared by the home, timetable and calendar screens.
export const view: {
  selectedDay: string;
  calendarMode: CalendarMode;
  weekend: boolean;
} = {
  selectedDay: today,
  calendarMode: initialCalendarMode(window.innerWidth),
  weekend: weekDay(today) > 5,
};
export const store = new LocalStore();
export const saves = new SaveQueue(store, () => data);
// Handlers for [data-action] clicks; render() clears them and each screen re-registers its own.
export const actions = new Map<string, () => unknown>();
export const action = (name: string, fn: () => unknown) =>
  actions.set(name, fn);
export const pageEpoch = new ViewEpoch();
// Modules with async work (PDF parsing, image decoding, API writes) register their
// in-flight counter so updates and page unload wait until the app is idle.
const busyCounters: (() => number)[] = [];
export function trackBusy(counter: () => number) {
  busyCounters.push(counter);
}
export function isBusy() {
  return busyCounters.some((count) => count() !== 0);
}
export function route() {
  return location.hash.slice(1).split("/")[0] || "home";
}
let renderRoute = () => {};
// main.ts installs the route dispatcher at startup.
export function setRenderer(fn: () => void) {
  renderRoute = fn;
}
export function render() {
  renderRoute();
}
export function navigate(destination: string) {
  if (route() === destination) render();
  else location.hash = destination;
}
