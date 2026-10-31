import { type CampusEvent, type Data, type Edit } from "./domain";
export interface EventValues {
  title: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  cancelled: boolean;
  scope: "course" | "occurrence";
}
export async function commitEvent(
  data: Data,
  original: CampusEvent,
  existing: boolean,
  courseId: string | undefined,
  values: EventValues,
  persistence: { changed: () => void; save: () => Promise<boolean> },
): Promise<void> {
  if (values.start >= values.end)
    throw Error("終了は開始より後にしてください。");
  if (existing) {
    const course = values.scope === "course" && courseId;
    const edits = course ? data.courseEdits : data.occurrenceEdits;
    const id = course || original.id;
    const edit: Edit = {
      id,
      title: values.title,
      location: values.location,
      start: values.start,
      end: values.end,
      allDay: values.allDay,
      cancelled: values.cancelled,
    };
    const index = edits.findIndex((edit) => edit.id === id);
    if (index < 0) edits.push(edit);
    else edits[index] = edit;
  } else {
    const next: CampusEvent = {
      ...original,
      title: values.title,
      location: values.location,
      start: values.start,
      end: values.end,
      allDay: values.allDay,
    };
    const index = data.addedEvents.findIndex(
      (event) => event.id === original.id,
    );
    if (index < 0) data.addedEvents.push(next);
    else data.addedEvents[index] = next;
  }
  const draft = data.eventDraft;
  delete data.eventDraft;
  persistence.changed();
  try {
    if (!(await persistence.save()))
      throw Error("保存に失敗しました。入力は保持しています。");
  } catch (error) {
    if (draft) {
      data.eventDraft = draft;
      persistence.changed();
    }
    throw error;
  }
}
