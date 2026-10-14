import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoSaver } from "./autoSaver";
import type { FileStore } from "../platform/fileStore";

function memoryStore() {
  const files = new Map<string, string>();
  const writes: [string, string][] = [];
  const store: FileStore = {
    read: async (path) => files.get(path) ?? null,
    write: async (path, content) => {
      writes.push([path, content]);
      files.set(path, content);
    },
  };
  return { store, files, writes };
}

describe("AutoSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("글자 입력은 1초 동안 추가 입력이 없을 때 저장한다", async () => {
    const { store, writes } = memoryStore();
    const saver = new AutoSaver(store);

    saver.schedule("someday.md", "가", "debounce");
    await vi.advanceTimersByTimeAsync(999);
    expect(writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([["someday.md", "가"]]);
  });

  it("1초 안에 이어서 입력하면 기다림이 다시 시작되고 마지막 내용만 한 번 저장한다", async () => {
    const { store, writes } = memoryStore();
    const saver = new AutoSaver(store);

    saver.schedule("someday.md", "가", "debounce");
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule("someday.md", "가나", "debounce");
    await vi.advanceTimersByTimeAsync(600);
    expect(writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toEqual([["someday.md", "가나"]]);
  });

  it("체크·삭제·이동은 즉시 저장하고, 같은 파일의 기다리던 입력은 취소한다", async () => {
    const { store, writes } = memoryStore();
    const saver = new AutoSaver(store);

    saver.schedule("someday.md", "입력 중", "debounce");
    saver.schedule("someday.md", "체크함", "now");
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual([["someday.md", "체크함"]]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toEqual([["someday.md", "체크함"]]);
  });

  it("flush는 기다리던 저장을 모두 바로 쓴다 (창을 벗어날 때, 앱을 끌 때)", async () => {
    const { store, writes } = memoryStore();
    const saver = new AutoSaver(store);

    saver.schedule("someday.md", "언젠가", "debounce");
    saver.schedule("daily/2026-10-14.md", "오늘", "debounce");
    await saver.flush();

    expect(writes).toEqual([
      ["someday.md", "언젠가"],
      ["daily/2026-10-14.md", "오늘"],
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toHaveLength(2);
  });

  it("저장 상태를 알린다: 기다리는 동안 pending, 다 쓰면 saved", async () => {
    const { store } = memoryStore();
    const saver = new AutoSaver(store);
    const seen: string[] = [];
    saver.onStatus((s) => seen.push(s));

    saver.schedule("someday.md", "가", "debounce");
    expect(seen.at(-1)).toBe("pending");

    await vi.advanceTimersByTimeAsync(1000);
    expect(seen.at(-1)).toBe("saved");
  });

  it("쓰기에 실패하면 error를 알리고, 다음 flush에서 다시 시도한다", async () => {
    let fail = true;
    const writes: string[] = [];
    const store: FileStore = {
      read: async () => null,
      write: async (_path, content) => {
        if (fail) throw new Error("디스크 꽉 참");
        writes.push(content);
      },
    };
    const saver = new AutoSaver(store);
    const seen: string[] = [];
    saver.onStatus((s) => seen.push(s));

    saver.schedule("someday.md", "가", "now");
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.at(-1)).toBe("error");

    fail = false;
    await saver.flush();
    expect(writes).toEqual(["가"]);
    expect(seen.at(-1)).toBe("saved");
  });

  it("쓰기에 실패하면 5초 뒤 스스로 다시 시도한다", async () => {
    let fail = true;
    const writes: string[] = [];
    const store: FileStore = {
      read: async () => null,
      write: async (_path, content) => {
        if (fail) throw new Error("잠깐 실패");
        writes.push(content);
      },
    };
    const saver = new AutoSaver(store);
    saver.schedule("someday.md", "가", "now");
    await vi.advanceTimersByTimeAsync(0);
    fail = false;
    await vi.advanceTimersByTimeAsync(4999);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual(["가"]);
  });
});
