import type { Data } from "./domain";

// Exact occurrence IDs only. Missing events deliberately do not prune orphaned memos.
export function setEventMemo(data: Data, eventId: string, text: string, modified = new Date().toISOString()) {
  if (text.length > 5000) throw Error("メモは5000文字以内で入力してください。");
  if (!data.eventMemos) data.eventMemos = {};
  if (text.length) Object.defineProperty(data.eventMemos, eventId, { value: { text, modified }, enumerable: true, writable: true, configurable: true });
  else delete data.eventMemos[eventId];
}
export function eventMemoText(data: Data, eventId: string) {
  return Object.hasOwn(data.eventMemos ?? {}, eventId) ? data.eventMemos![eventId].text : "";
}
