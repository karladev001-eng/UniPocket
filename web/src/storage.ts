import { emptyData, validateData, type Data } from "./domain";
export class LocalStore {
  private db?: IDBDatabase;
  revision = 0;
  blocked = false;
  async open(): Promise<Data> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("shizudai-pocket", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("state");
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          r.result.close();
          this.blocked = true;
        };
        resolve(r.result);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () =>
        reject(Error("別タブを閉じて保存データを再読み込みしてください。"));
    });
    try {
      const row = await new Promise<
        { revision: number; data: unknown } | undefined
      >((resolve, reject) => {
        const r = this.db!.transaction("state")
          .objectStore("state")
          .get("personal");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      if (!row) return emptyData();
      validateData(row.data);
      this.revision = row.revision;
      return row.data;
    } catch (e) {
      this.blocked = true;
      throw e;
    }
  }
  async save(data: Data): Promise<void> {
    if (this.blocked || !this.db)
      throw Error("保存できません。原本保護のため書込を停止しています。");
    validateData(data);
    const snapshot = structuredClone(data);
    const next = this.revision + 1;
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction("state", "readwrite"),
        store = tx.objectStore("state");
      let error: Error | null = null;
      const r = store.get("personal");
      r.onsuccess = () => {
        const actual = r.result?.revision ?? 0;
        if (actual !== this.revision) {
          error = Error(
            "別タブが保存しました。このタブの入力を書き出してから再読み込みしてください。",
          );
          tx.abort();
          return;
        }
        store.put({ revision: next, data: snapshot }, "personal");
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(error ?? tx.error ?? Error("保存を中止しました。"));
      tx.onerror = () => reject(tx.error);
    });
    this.revision = next;
  }
  close() {
    this.db?.close();
  }
}
// Serialize snapshots: an older in-flight save never overwrites later input.
export class SaveQueue {
  private pending: Promise<void> = Promise.resolve();
  generation = 0;
  saved = 0;
  constructor(
    private store: LocalStore,
    private current: () => Data,
  ) {}
  changed() {
    this.generation++;
  }
  async flush() {
    if (!this.dirty) {
      await this.pending;
      return;
    }
    const target = this.generation;
    const snapshot = structuredClone(this.current());
    const run = this.pending
      .catch(() => {})
      .then(async () => {
        await this.store.save(snapshot);
        this.saved = target;
      });
    this.pending = run;
    await run;
  }
  get dirty() {
    return this.generation !== this.saved;
  }
}
