import { AdminClient, EditorState, dateRange } from "./model";
import type { ArticleEditor } from "./article-editor";
// Session-wide state shared by the screen modules. No DOM here.
export type Section = "overview" | "articles" | "announcements" | "surveys" | "metrics";
export const sections: [
    Section,
    string
][] = [["overview", "概要"], ["articles", "記事"], ["announcements", "お知らせ"], ["surveys", "アンケート"], ["metrics", "集計"]];
export const client = new AdminClient();
/** Mutable view state: current section, stale-response token, open editors and filters. */
export const ui = {
    section: "overview" as Section,
    generation: 0,
    editor: undefined as EditorState | undefined,
    articleEditor: undefined as ArticleEditor | undefined,
    busy: false,
    reportTab: false,
    range: dateRange(7),
};
/** Navigation entry points, filled in by main.ts so screens need not import the router (avoids import cycles). */
export const navigation = {
    go: async (_next: Section): Promise<void> => { },
    reload: async (): Promise<void> => { },
};
