import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { AutoSaver } from "../core/autoSaver";
import { DEFAULT_SETTINGS, type Settings } from "../core/settings";
import { parseItems } from "../core/todoFile";
import type { TodoItem } from "../core/todoList";
import type { FileStore } from "../platform/fileStore";
import { rollover, serialized } from "./useRollover";

function memory(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const store: FileStore = {
    read: async (p) => {
      await new Promise((r) => setTimeout(r, 1));
      return files.get(p) ?? null;
    },
    write: async (p, c) => void (c === "" ? files.delete(p) : files.set(p, c)),
  };
  return { files, store };
}

const settingsWith = (patch: Partial<Settings>) => ref<Settings>({ ...DEFAULT_SETTINGS, ...patch });
let n = 0;
const items = (md: string) => parseItems(md, () => `t${++n}`).items;

describe("자정 정리는 한 번에 하나만 돈다 (리뷰 MED)", () => {
  it("두 곳(창 focus·3초 확인)이 동시에 불러도 옮긴 할 일이 둘이 되지 않는다", async () => {
    const { files, store } = memory({
      "daily/2026-10-13.md": "- [ ] 어제 일\n",
      "daily/2026-10-14.md": "- [ ] 오늘 원래\n",
    });
    const saver = new AutoSaver(store);
    const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: "2026-10-13" });
    const someday = ref<TodoItem[]>([]);
    const run = serialized(() => rollover("2026-10-14", settings, store, saver, someday));
    await Promise.all([run(), run()]);
    expect(files.get("daily/2026-10-14.md")).toBe("- [ ] 오늘 원래\n- [ ] 어제 일 <!-- from:2026-10-13 -->\n");
    expect(files.get("daily/2026-10-13.md")).toBeUndefined();
  });
});

describe("열려 있는 파일은 목록을 거쳐 옮긴다 (QA3-01)", () => {
  it("지난 날을 보고 있으면 그날 파일을 따로 쓰지 않고 그 목록에서 뺀다", async () => {
    const { files, store } = memory({
      "daily/2026-10-13.md": "- [ ] 어제 미완료\n- [x] 어제 끝냄\n",
      "daily/2026-10-14.md": "- [ ] 오늘 원래\n",
    });
    const saver = new AutoSaver(store);
    const writes: string[] = [];
    const schedule = saver.schedule.bind(saver);
    saver.schedule = (path, ...rest) => {
      writes.push(path);
      schedule(path, ...rest);
    };
    const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: "2026-10-13" });
    const shown = ref(items(files.get("daily/2026-10-13.md")!));
    await rollover("2026-10-14", settings, store, saver, ref([]), {
      openLists: () => [{ path: "daily/2026-10-13.md", items: shown }],
    });
    expect(shown.value.map((i) => i.text)).toEqual(["어제 끝냄"]);
    expect(writes).not.toContain("daily/2026-10-13.md");
    expect(files.get("daily/2026-10-14.md")).toBe("- [ ] 오늘 원래\n- [ ] 어제 미완료 <!-- from:2026-10-13 -->\n");
  });

  it("목록에 저장 전 고침이 있으면 그 고침째 옮긴다", async () => {
    const { files, store } = memory({ "daily/2026-10-13.md": "- [ ] 어제\n- [ ] 둘\n" });
    const saver = new AutoSaver(store);
    const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: "2026-10-13" });
    const shown = ref(items("- [ ] 어제 고침\n- [x] 둘\n"));
    await rollover("2026-10-14", settings, store, saver, ref([]), {
      openLists: () => [{ path: "daily/2026-10-13.md", items: shown }],
    });
    expect(shown.value.map((i) => i.text)).toEqual(["둘"]);
    expect(files.get("daily/2026-10-14.md")).toBe("- [ ] 어제 고침 <!-- from:2026-10-13 -->\n");
  });
});

describe("다른 편집기가 쓴 빈 칸 줄 (QA6-02)", () => {
  it("'다음 날로'에서 빈 칸 줄은 지난 날 파일에 그대로 남는다", async () => {
    const { files, store } = memory({ "daily/2026-10-13.md": "- [ ] a\n- [ ] \u3164\n- [x] 끝\n" });
    const saver = new AutoSaver(store);
    const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: "2026-10-13" });
    await rollover("2026-10-14", settings, store, saver, ref([]));
    expect(files.get("daily/2026-10-13.md")).toBe("- [ ] \u3164\n- [x] 끝\n");
    expect(files.get("daily/2026-10-14.md")).toBe("- [ ] a <!-- from:2026-10-13 -->\n");
  });

  it("'언젠가로'에서도 빈 칸 줄(ZWSP)은 지난 날 파일에 남는다", async () => {
    const { files, store } = memory({ "daily/2026-10-13.md": "- [ ] a\n- [ ] \u200b\n" });
    const saver = new AutoSaver(store);
    const settings = settingsWith({ carryOver: "someday", lastRolloverDate: "2026-10-13" });
    const someday = ref<TodoItem[]>([]);
    await rollover("2026-10-14", settings, store, saver, someday);
    expect(files.get("daily/2026-10-13.md")).toBe("- [ ] \u200b\n");
    expect(someday.value.map((i) => i.text)).toEqual(["a"]);
  });
});

describe("열려 있지 않은 날의 쓰지 못한 편집 (리뷰 N2)", () => {
  it("저장이 계속 실패해 남은 편집이 있으면 파일이 아니라 그 편집을 원본으로 옮기고, 그 편집을 덮지 않는다", async () => {
    const { files, store } = memory({ "daily/2026-10-13.md": "- [ ] 어제\n" });
    const failing: FileStore = {
      ...store,
      write: async (p, c) => {
        if (p === "daily/2026-10-13.md") throw "디스크 오류";
        return store.write(p, c);
      },
    };
    const saver = new AutoSaver(failing);
    saver.schedule("daily/2026-10-13.md", "- [ ] 어제 고침\n- [ ] 새 일\n- [x] 끝냄\n", "now", "- [ ] 어제\n");
    await saver.flush();
    const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: "2026-10-13" });
    await rollover("2026-10-14", settings, failing, saver, ref([]));
    expect(files.get("daily/2026-10-14.md")).toBe(
      "- [ ] 어제 고침 <!-- from:2026-10-13 -->\n- [ ] 새 일 <!-- from:2026-10-13 -->\n",
    );
    expect(saver.pendingFor("daily/2026-10-13.md")).toEqual({ content: "- [x] 끝냄\n", base: "- [ ] 어제\n" });
  });
});

describe("쓰는 중이거나 기준을 모르는 편집에서는 옮기지 않는다 (리뷰 N4)", () => {
  const D13 = "daily/2026-10-13.md";
  const D14 = "daily/2026-10-14.md";

  function casMemory(initial: Record<string, string>) {
    const files = new Map(Object.entries(initial));
    let hold: Promise<void> | null = null;
    let release = () => {};
    const store: FileStore = {
      read: async (p) => files.get(p) ?? null,
      write: async (p, c) => void (c === "" ? files.delete(p) : files.set(p, c)),
      writeIf: async (p, c, e) => {
        if (p === D13 && hold) await hold;
        const current = files.get(p) ?? "";
        if (e !== null && current !== e) return { ok: false, current };
        if (c === "") files.delete(p);
        else files.set(p, c);
        return { ok: true, current: null };
      },
    };
    return {
      files,
      store,
      hang() {
        hold = new Promise((r) => (release = r));
      },
      release() {
        hold = null;
        release();
      },
    };
  }

  it("지난 날 저장이 응답 없이 쓰는 중이면 그날은 다음 정리로 미루고, 풀린 뒤 한 번만 옮긴다", async () => {
    vi.useFakeTimers();
    try {
      const m = casMemory({ [D13]: "- [ ] 어제\n" });
      m.hang();
      const saver = new AutoSaver(m.store);
      saver.schedule(D13, "- [ ] 어제\n- [ ] 새 일\n", "now", "- [ ] 어제\n");
      await vi.advanceTimersByTimeAsync(0);
      const flushed = saver.flush();
      await vi.advanceTimersByTimeAsync(10_000);
      await flushed;
      const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: "2026-10-13" });
      const first = rollover("2026-10-14", settings, m.store, saver, ref([]));
      await vi.advanceTimersByTimeAsync(0);
      await first;
      expect(settings.value).toMatchObject({ lastRolloverDate: "2026-10-14", rolloverPending: ["2026-10-13"] });
      expect(m.files.get(D14)).toBeUndefined();
      m.release();
      await vi.advanceTimersByTimeAsync(0);
      const second = rollover("2026-10-14", settings, m.store, saver, ref([]));
      await vi.advanceTimersByTimeAsync(0);
      await second;
      expect(m.files.get(D14)).toBe("- [ ] 어제 <!-- from:2026-10-13 -->\n- [ ] 새 일 <!-- from:2026-10-13 -->\n");
      expect(m.files.get(D13)).toBeUndefined();
      expect(settings.value.lastRolloverDate).toBe("2026-10-14");
      expect(settings.value.rolloverPending).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("L5 쓰는 중이라 미룬 날은 미룬 그때 있던 할 일만 옮긴다 — 그 뒤 그날에 새로 적은 할 일은 그날에 남는다", async () => {
    vi.useFakeTimers();
    try {
      const m = casMemory({ [D13]: "- [ ] 어제\n" });
      m.hang();
      const saver = new AutoSaver(m.store);
      saver.schedule(D13, "- [ ] 어제\n- [ ] 새 일\n", "now", "- [ ] 어제\n");
      await vi.advanceTimersByTimeAsync(0);
      const flushed = saver.flush();
      await vi.advanceTimersByTimeAsync(10_000);
      await flushed;
      const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: "2026-10-13" });
      const deferred = new Map<string, string[]>();
      const first = rollover("2026-10-14", settings, m.store, saver, ref([]), { deferred });
      await vi.advanceTimersByTimeAsync(0);
      await first;
      expect(settings.value.rolloverPending).toEqual(["2026-10-13"]);
      // 미룬 뒤 사용자가 그날에 이어 적는다
      saver.schedule(D13, "- [ ] 어제\n- [ ] 새 일\n- [ ] 기록용\n", "now", "- [ ] 어제\n- [ ] 새 일\n");
      m.release();
      await vi.advanceTimersByTimeAsync(0);
      await saver.flush();
      const second = rollover("2026-10-14", settings, m.store, saver, ref([]), { deferred });
      await vi.advanceTimersByTimeAsync(0);
      await second;
      expect(m.files.get(D14)).toBe("- [ ] 어제 <!-- from:2026-10-13 -->\n- [ ] 새 일 <!-- from:2026-10-13 -->\n");
      expect(m.files.get(D13)).toBe("- [ ] 기록용\n");
      expect(settings.value.rolloverPending).toBeUndefined();
      expect(deferred.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("기준을 모르는(\"\") 쓰지 못한 편집이면 그날은 미룬다 — 합집합으로 합쳐 옮긴 할 일이 그날에 되살아나지 않게", async () => {
    const m = casMemory({ [D13]: "- [ ] 새 폴더 일\n" });
    const failing: FileStore = { ...m.store, writeIf: async (p, c, e) => (p === D13 ? Promise.reject("EIO") : m.store.writeIf!(p, c, e)) };
    const saver = new AutoSaver(failing);
    saver.schedule(D13, "- [ ] 옛 폴더 일\n", "now", "");
    await saver.flush();
    const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: "2026-10-13" });
    await rollover("2026-10-14", settings, failing, saver, ref([]));
    expect(settings.value).toMatchObject({ lastRolloverDate: "2026-10-14", rolloverPending: ["2026-10-13"] });
    expect(m.files.get(D14)).toBeUndefined();
    expect(saver.pendingFor(D13)?.content).toBe("- [ ] 옛 폴더 일\n");
  });
});

describe("정리한 날은 다시 정리하지 않는다 (QA10 R10-9)", () => {
  function badDay(initial: Record<string, string>, bad: Set<string>) {
    const m = memory(initial);
    const read = m.store.read;
    m.store.read = async (p) => {
      if (bad.has(p)) throw "글자로 풀 수 없는 파일이에요 (UTF-8이 아니에요)";
      return read(p);
    };
    return m;
  }

  it("못 읽은 날만 남겨 두고, 그 뒤 정리한 날에 새로 적은 할 일은 다시 옮기지 않는다", async () => {
    const bad = new Set(["daily/2026-10-11.md"]);
    const { files, store } = badDay(
      { "daily/2026-10-11.md": "- [ ] 11\n", "daily/2026-10-12.md": "- [ ] 12\n", "daily/2026-10-14.md": "- [ ] 오늘\n" },
      bad,
    );
    const saver = new AutoSaver(store);
    const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: "2026-10-11" });
    const first = await rollover("2026-10-14", settings, store, saver, ref([]));
    expect(first.unreadable).toEqual(["daily/2026-10-11.md"]);
    expect(settings.value.lastRolloverDate).toBe("2026-10-14");
    expect(settings.value.rolloverPending).toEqual(["2026-10-11"]);
    files.set("daily/2026-10-12.md", "- [ ] 나중에 적음\n");
    await rollover("2026-10-14", settings, store, saver, ref([]));
    expect(files.get("daily/2026-10-12.md")).toBe("- [ ] 나중에 적음\n");
    bad.clear();
    await rollover("2026-10-14", settings, store, saver, ref([]));
    expect(files.get("daily/2026-10-12.md")).toBe("- [ ] 나중에 적음\n");
    expect(files.get("daily/2026-10-14.md")).toBe("- [ ] 오늘\n- [ ] 12 <!-- from:2026-10-12 -->\n- [ ] 11 <!-- from:2026-10-11 -->\n");
    expect(settings.value.rolloverPending).toBeUndefined();
  });

  it("남겨 둔 날이 있어도 자정이 지나면 새로 지난 날은 함께 정리한다", async () => {
    const bad = new Set(["daily/2026-10-11.md"]);
    const { files, store } = badDay({ "daily/2026-10-11.md": "x", "daily/2026-10-14.md": "- [ ] 어제\n" }, bad);
    const saver = new AutoSaver(store);
    const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: "2026-10-14", rolloverPending: ["2026-10-11"] });
    await rollover("2026-10-15", settings, store, saver, ref([]));
    expect(files.get("daily/2026-10-15.md")).toBe("- [ ] 어제 <!-- from:2026-10-14 -->\n");
    expect(settings.value).toMatchObject({ lastRolloverDate: "2026-10-15", rolloverPending: ["2026-10-11"] });
  });
});

describe("정리 기록이 없는 폴더 (QA10 R10-12)", () => {
  it("설정대로 옮기는데 기록이 없으면 가장 최근 지난 날부터 정리한다", async () => {
    const { files, store } = memory({ "daily/2026-10-10.md": "- [ ] 옛날\n", "daily/2026-10-12.md": "- [ ] 밀린일\n" });
    const saver = new AutoSaver(store);
    const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: null });
    await rollover("2026-10-14", settings, store, saver, ref([]));
    expect(files.get("daily/2026-10-14.md")).toBe("- [ ] 밀린일 <!-- from:2026-10-12 -->\n");
    expect(files.get("daily/2026-10-10.md")).toBe("- [ ] 옛날\n");
    expect(settings.value.lastRolloverDate).toBe("2026-10-14");
  });

  it("그대로 남기기면 찾아보지 않고 오늘로 둔다", async () => {
    const { store } = memory({ "daily/2026-10-12.md": "- [ ] 밀린일\n" });
    const reads: string[] = [];
    const read = store.read;
    store.read = (p) => (reads.push(p), read(p));
    const settings = settingsWith({ carryOver: "keep", lastRolloverDate: null });
    await rollover("2026-10-14", settings, store, new AutoSaver(store), ref([]));
    expect(reads).toEqual([]);
    expect(settings.value.lastRolloverDate).toBe("2026-10-14");
  });

  // 다음 날로가 기본이라 처음 켜는 모든 폴더가 여기로 온다. 400일을 하루씩 읽지 않고 목록을 한 번 본다
  const listing = (files: Map<string, string>) => async (dir: string) =>
    [...files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1));

  it("새 폴더면 지난 날을 하루씩 읽어 보지 않고 목록 한 번으로 끝낸다", async () => {
    const { files, store } = memory({});
    store.list = listing(files);
    const reads: string[] = [];
    const read = store.read;
    store.read = (p) => (reads.push(p), read(p));
    const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: null });
    await rollover("2026-10-14", settings, store, new AutoSaver(store), ref([]));
    expect(reads).toEqual([]);
    expect(settings.value.lastRolloverDate).toBe("2026-10-14");
  });

  it("목록으로 찾아도 가장 최근 지난 날부터 정리한다", async () => {
    const { files, store } = memory({ "daily/2026-10-10.md": "- [ ] 옛날\n", "daily/2026-10-12.md": "- [ ] 밀린일\n" });
    store.list = listing(files);
    const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: null });
    await rollover("2026-10-14", settings, store, new AutoSaver(store), ref([]));
    expect(files.get("daily/2026-10-14.md")).toBe("- [ ] 밀린일 <!-- from:2026-10-12 -->\n");
    expect(files.get("daily/2026-10-10.md")).toBe("- [ ] 옛날\n");
  });

  it("목록에서 날짜 파일이 아닌 것·오늘 이후·너무 오래된 날은 고르지 않는다", async () => {
    const { files, store } = memory({ "daily/2026-10-14.md": "- [ ] 오늘\n" });
    store.list = async () => ["2026-10-14.md", "2026-10-20.md", "notes.md", ".2026-10-13.md.icloud", "2020-01-01.md", "2026-10-13.md.bak"];
    const settings = settingsWith({ carryOver: "next-day", lastRolloverDate: null });
    await rollover("2026-10-14", settings, store, new AutoSaver(store), ref([]));
    expect(files.get("daily/2026-10-14.md")).toBe("- [ ] 오늘\n");
    expect(settings.value.lastRolloverDate).toBe("2026-10-14");
  });
});
