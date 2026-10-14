import type { FileStore } from "../platform/fileStore";

export type SaveMode = "debounce" | "now";
export type SaveStatus = "saved" | "pending" | "error";

const DEBOUNCE_MS = 1000;
const RETRY_MS = 5000;

export class AutoSaver {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Map<string, string>();
  private listeners: ((status: SaveStatus) => void)[] = [];

  constructor(private readonly store: FileStore) {}

  onStatus(listener: (status: SaveStatus) => void): void {
    this.listeners.push(listener);
  }

  schedule(path: string, content: string, mode: SaveMode): void {
    clearTimeout(this.timers.get(path));
    this.timers.delete(path);
    this.pending.set(path, content);
    this.emit("pending");
    if (mode === "now") {
      void this.save(path);
    } else {
      this.timers.set(
        path,
        setTimeout(() => void this.save(path), DEBOUNCE_MS),
      );
    }
  }

  hasPending(path: string): boolean {
    return this.pending.has(path);
  }

  async flush(): Promise<void> {
    for (const path of [...this.pending.keys()]) {
      clearTimeout(this.timers.get(path));
      await this.save(path);
    }
  }

  private async save(path: string): Promise<void> {
    const content = this.pending.get(path);
    if (content === undefined) return;
    this.pending.delete(path);
    this.timers.delete(path);
    try {
      await this.store.write(path, content);
    } catch {
      // 그 사이 새 내용이 들어오지 않았다면 다음 flush에서 다시 쓰도록 되돌려 둔다
      if (!this.pending.has(path)) {
        this.pending.set(path, content);
        this.timers.set(
          path,
          setTimeout(() => void this.save(path), RETRY_MS),
        );
      }
      this.emit("error");
      return;
    }
    if (this.pending.size === 0) this.emit("saved");
  }

  private emit(status: SaveStatus) {
    for (const listener of this.listeners) listener(status);
  }
}
