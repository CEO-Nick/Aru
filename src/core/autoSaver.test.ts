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

  it("파일에 실제로 쓴 뒤 어떤 내용을 썼는지 알린다", async () => {
    const { store } = memoryStore();
    const saver = new AutoSaver(store);
    const written: [string, string][] = [];
    saver.onWrite((path, content) => written.push([path, content]));
    saver.schedule("someday.md", "가", "now");
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual([["someday.md", "가"]]);
  });
});

function casStore(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const writes: [string, string][] = [];
  const store: FileStore = {
    read: async (path) => files.get(path) ?? null,
    write: async (path, content) => {
      writes.push([path, content]);
      files.set(path, content);
    },
    writeIf: async (path, content, expected) => {
      const current = files.get(path) ?? "";
      if (expected !== null && current !== expected) return { ok: false, current };
      writes.push([path, content]);
      files.set(path, content);
      return { ok: true, current: null };
    },
  };
  return { store, files, writes };
}

describe("AutoSaver: 본 적 없는 변경을 덮어쓰지 않는다(write_text_if)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("저장 전에 다른 프로그램이 파일을 바꿨으면 3-way로 합쳐 쓰고, 합친 내용을 알린다", async () => {
    const { store, files } = casStore({ "a.md": "- [ ] 하나\n" });
    const saver = new AutoSaver(store);
    const seen: [string, string, string][] = [];
    saver.onWrite((path, written, scheduled) => seen.push([path, written, scheduled]));

    saver.schedule("a.md", "- [ ] 하나 고침\n", "debounce", "- [ ] 하나\n");
    files.set("a.md", "- [ ] 하나\n- [ ] CLI가 추가\n");
    await vi.advanceTimersByTimeAsync(1000);

    expect(files.get("a.md")).toBe("- [ ] 하나 고침\n- [ ] CLI가 추가\n");
    expect(seen).toEqual([["a.md", "- [ ] 하나 고침\n- [ ] CLI가 추가\n", "- [ ] 하나 고침\n"]]);
  });

  it("실패한 저장은 기준(base)을 지닌 채 다시 시도하고, 그 사이 바뀐 파일과 합친다", async () => {
    const { store, files } = casStore({ "a.md": "- [ ] 하나\n" });
    let broken = true;
    const flaky: FileStore = {
      ...store,
      writeIf: (path, content, expected) => (broken ? Promise.reject("EIO") : store.writeIf!(path, content, expected)),
    };
    const saver = new AutoSaver(flaky);
    saver.schedule("a.md", "- [ ] 하나 고침\n", "now", "- [ ] 하나\n");
    await vi.advanceTimersByTimeAsync(0);
    files.set("a.md", "- [ ] 하나\n- [ ] 외부에서 추가\n");
    broken = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(files.get("a.md")).toBe("- [ ] 하나 고침\n- [ ] 외부에서 추가\n");
  });

  it("저장 폴더가 바뀌면(rebaseAll(\"\")) 새 폴더 파일과 합집합으로 합친다 — 지운 줄로 보지 않는다", async () => {
    const { store, files } = casStore({ "a.md": "- [ ] 새 폴더에 있던 것\n" });
    const saver = new AutoSaver(store);
    saver.schedule("a.md", "- [ ] 옛 폴더 것\n- [ ] 내가 적음\n", "debounce", "- [ ] 옛 폴더 것\n");
    saver.rebaseAll("");
    await saver.flush();
    expect(files.get("a.md")).toBe("- [ ] 새 폴더에 있던 것\n- [ ] 옛 폴더 것\n- [ ] 내가 적음\n");
    expect(saver.idle()).toBe(true);
  });

  it("앞선 저장이 끝나면 이어진 저장의 기준을 그 내용으로 옮긴다(자기 저장을 충돌로 보지 않는다)", async () => {
    const { store, files, writes } = casStore({ "a.md": "A\n" });
    const saver = new AutoSaver(store);
    saver.schedule("a.md", "A\nB\n", "now", "A\n");
    saver.schedule("b.md", "x\n", "now");
    saver.schedule("a.md", "A\nB\nC\n", "debounce", "A\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(files.get("a.md")).toBe("A\nB\nC\n");
    expect(writes.filter(([p]) => p === "a.md").length).toBeGreaterThanOrEqual(1);
  });
});

/** writeIf가 gate를 기다리게 해서 "쓰는 중"을 만든다 */
function slowCasStore(initial: Record<string, string> = {}) {
  const cas = casStore(initial);
  let release: (() => void) | null = null;
  let gate: Promise<void> | null = null;
  const store: FileStore = {
    ...cas.store,
    writeIf: async (path, content, expected) => {
      if (gate) await gate;
      return cas.store.writeIf!(path, content, expected);
    },
  };
  return {
    ...cas,
    store,
    hold() {
      gate = new Promise((r) => (release = r));
    },
    release() {
      gate = null;
      release?.();
    },
  };
}

describe("AutoSaver: 쓰는 중인 저장도 보인다 (리뷰 HIGH-2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("쓰는 중이면 hasPending·pendingFor가 그 내용을 알려 주고 idle은 false다", async () => {
    const s = slowCasStore({ "a.md": "A\n" });
    const saver = new AutoSaver(s.store);
    s.hold();
    saver.schedule("a.md", "A\nB\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.hasPending("a.md")).toBe(true);
    expect(saver.pendingFor("a.md")).toEqual({ content: "A\nB\n", base: "A\n" });
    expect(saver.idle()).toBe(false);
    s.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.hasPending("a.md")).toBe(false);
    expect(saver.idle()).toBe(true);
  });

  it("flush는 이미 나간 저장이 충돌로 합쳐 다시 쓰는 것까지 기다린다(종료·새로고침 직전)", async () => {
    const s = slowCasStore({ "a.md": "- [ ] 하나\n" });
    const saver = new AutoSaver(s.store);
    s.hold();
    saver.schedule("a.md", "- [ ] 하나\n- [ ] 내 일\n", "now", "- [ ] 하나\n");
    await vi.advanceTimersByTimeAsync(0);
    s.files.set("a.md", "- [ ] 하나\n- [ ] CLI\n");
    const flushed = saver.flush();
    let done = false;
    void flushed.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    s.release();
    await flushed;
    expect(s.files.get("a.md")).toBe("- [ ] 하나\n- [ ] 내 일\n- [ ] CLI\n");
    expect(saver.idle()).toBe(true);
  });

  it("같은 파일의 저장은 앞 저장이 끝난 뒤에 쓴다(앞 저장의 기준으로 뒤 저장이 먼저 써지지 않는다)", async () => {
    const s = slowCasStore({ "a.md": "A\n" });
    const saver = new AutoSaver(s.store);
    s.hold();
    saver.schedule("a.md", "A\nB\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    saver.schedule("a.md", "A\nB\nC\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.writes).toEqual([]);
    s.release();
    await saver.flush();
    expect(s.writes.map(([, c]) => c)).toEqual(["A\nB\n", "A\nB\nC\n"]);
  });
});

describe("AutoSaver: 할 일 파일(.md)이 아닌 파일 (리뷰 MED)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("settings.json이 충돌하면 줄 단위로 합치지 않고 내 내용으로 쓴다 — 합치면 JSON이 깨진다", async () => {
    const { store, files } = casStore({ "settings.json": '{\n  "opacity": 90\n}' });
    const saver = new AutoSaver(store);
    saver.schedule("settings.json", '{\n  "opacity": 50\n}', "debounce", "");
    await saver.flush();
    expect(JSON.parse(files.get("settings.json")!)).toEqual({ opacity: 50 });
  });

  it("rebaseAll은 할 일 파일(.md)의 기준만 바꾼다", async () => {
    const s = casStore({ "a.md": "- [ ] 새 폴더\n", "settings.json": '{"a":1}' });
    const saver = new AutoSaver(s.store);
    saver.schedule("a.md", "- [ ] 옛 폴더\n", "debounce", "- [ ] 옛 기준\n");
    saver.schedule("settings.json", '{"a":2}', "debounce", '{"a":1}');
    saver.rebaseAll("");
    expect(saver.pendingFor("a.md")?.base).toBe("");
    expect(saver.pendingFor("settings.json")?.base).toBe('{"a":1}');
  });
});

describe("AutoSaver: 라운드 4 리뷰", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("M1 합쳐 다시 쓰다 실패한 저장이 재시도로 써지면, 알릴 때 화면이 처음 예약한 내용을 scheduled로 넘긴다", async () => {
    const { store, files } = casStore({ "a.md": "- [ ] 하나\n" });
    let calls = 0;
    const flaky: FileStore = {
      ...store,
      // 첫 시도는 충돌, 합친 내용을 쓰는 두 번째 시도는 실패(잠금 3초 초과 등)
      writeIf: (path, content, expected) => (++calls === 2 ? Promise.reject("LOCKED") : store.writeIf!(path, content, expected)),
    };
    const saver = new AutoSaver(flaky);
    const seen: [string, string][] = [];
    saver.onWrite((_p, written, scheduled) => seen.push([written, scheduled]));
    saver.schedule("a.md", "- [ ] 하나 고침\n", "debounce", "- [ ] 하나\n");
    files.set("a.md", "- [ ] 하나\n- [ ] CLI\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([]);
    await saver.flush();
    expect(files.get("a.md")).toBe("- [ ] 하나 고침\n- [ ] CLI\n");
    expect(seen).toEqual([["- [ ] 하나 고침\n- [ ] CLI\n", "- [ ] 하나 고침\n"]]);
  });

  // 라운드 5(리뷰 N6): 상한을 넘긴 것은 실패가 아니라 늦어짐으로 알린다
  it("M2 응답이 오지 않는 저장이 있어도 flush는 10초 뒤 끝나고 늦어짐을 알린다", async () => {
    const { store } = casStore({ "a.md": "A\n" });
    const hung: FileStore = { ...store, writeIf: () => new Promise(() => {}) };
    const saver = new AutoSaver(hung);
    const statuses: string[] = [];
    saver.onStatus((s) => statuses.push(s));
    saver.schedule("a.md", "A\nB\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    let done = false;
    void saver.flush().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(9_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(done).toBe(true);
    expect(statuses.at(-1)).toBe("slow");
    // 같은 파일의 뒤 저장은 여전히 앞 저장 뒤에 줄 선다(먼저 써서 앞 저장의 기준을 깨지 않는다)
    expect(saver.hasPending("a.md")).toBe(true);
  });

  it("M2 다른 파일의 기다리는 저장은 막힌 파일과 상관없이 flush에서 쓴다", async () => {
    const { store, files } = casStore({ "a.md": "A\n", "b.md": "x\n" });
    const hung: FileStore = {
      ...store,
      writeIf: (path, content, expected) => (path === "a.md" ? new Promise(() => {}) : store.writeIf!(path, content, expected)),
    };
    const saver = new AutoSaver(hung);
    saver.schedule("a.md", "A\nB\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    saver.schedule("b.md", "x\ny\n", "debounce", "x\n");
    const flushed = saver.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    await flushed;
    expect(files.get("b.md")).toBe("x\ny\n");
  });

  it("writing은 쓰는 중인지 알려 준다(응답 전인 내 저장이 파일에 들어갔는지 모르는 동안 합치지 않으려고)", async () => {
    const s = slowCasStore({ "a.md": "A\n" });
    const saver = new AutoSaver(s.store);
    s.hold();
    saver.schedule("a.md", "A\nB\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.writing("a.md")).toBe(true);
    s.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.writing("a.md")).toBe(false);
  });
});

describe("AutoSaver: 라운드 5 (QA5-01·02, 리뷰 N1·N6·Q1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const hungStore = (initial: Record<string, string>) => {
    const s = slowCasStore(initial);
    s.hold();
    return s;
  };

  it("N1 응답 없는 파일이 여럿이어도 flush 대기 상한은 전체 10초 하나다(파일 수만큼 늘지 않는다)", async () => {
    const s = hungStore({ "a.md": "A\n", "b.md": "B\n", "settings.json": "{}" });
    const saver = new AutoSaver(s.store);
    saver.schedule("a.md", "A1\n", "debounce", "A\n");
    saver.schedule("b.md", "B1\n", "debounce", "B\n");
    saver.schedule("settings.json", "{\"x\":1}", "debounce", "{}");
    let done = false;
    void saver.flush().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe(true);
  });

  it("N1 쓰는 중인 저장이 막혔는데 그 뒤에 기다리는 저장도 있어도 10초에 끝난다(같은 파일을 두 번 기다리지 않는다)", async () => {
    const s = hungStore({ "a.md": "A\n" });
    const saver = new AutoSaver(s.store);
    saver.schedule("a.md", "A1\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    saver.schedule("a.md", "A12\n", "debounce", "A\n");
    let result: boolean | undefined;
    void saver.flush().then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(result).toBe(false);
  });

  it("N6 상한을 넘긴 것은 실패가 아니라 '늦어짐'(slow)으로 알리고, 그 사이 고쳐도 '기다리는 중'으로 가리지 않는다", async () => {
    const s = hungStore({ "a.md": "A\n" });
    const saver = new AutoSaver(s.store);
    const statuses: string[] = [];
    saver.onStatus((st) => statuses.push(st));
    saver.schedule("a.md", "A1\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    const flushed = saver.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await flushed).toBe(false);
    expect(statuses).not.toContain("error");
    expect(statuses.at(-1)).toBe("slow");
    saver.schedule("a.md", "A12\n", "debounce", "A\n");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(statuses.at(-1)).toBe("slow");
  });

  it("QA5-02 막힌 쓰기가 끝내 끝나면 그 뒤에 줄 선 가장 새 내용을 이어서 쓰고 '저장됨'이 된다", async () => {
    const s = hungStore({ "a.md": "A\n" });
    const saver = new AutoSaver(s.store);
    const statuses: string[] = [];
    saver.onStatus((st) => statuses.push(st));
    saver.schedule("a.md", "A1\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    void saver.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    saver.schedule("a.md", "A12\n", "debounce", "A\n");
    await vi.advanceTimersByTimeAsync(5_000);
    s.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.files.get("a.md")).toBe("A12\n");
    expect(statuses.at(-1)).toBe("saved");
    expect(saver.idle()).toBe(true);
  });

  it("QA5-02 막힌 쓰기가 끝내 실패하면 줄 선 새 내용을 이어서 쓰고, 실패했던 것도 남기지 않는다", async () => {
    const { store, files } = casStore({ "a.md": "A\n" });
    let fail: ((e: unknown) => void) | null = null;
    let first = true;
    const flaky: FileStore = {
      ...store,
      writeIf: (path, content, expected) => {
        if (!first) return store.writeIf!(path, content, expected);
        first = false;
        return new Promise((_r, reject) => (fail = reject));
      },
    };
    const saver = new AutoSaver(flaky);
    saver.schedule("a.md", "A1\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    void saver.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    saver.schedule("a.md", "A12\n", "debounce", "A\n");
    await vi.advanceTimersByTimeAsync(2_000);
    fail!("EIO");
    await vi.advanceTimersByTimeAsync(0);
    expect(files.get("a.md")).toBe("A12\n");
    expect(saver.idle()).toBe(true);
  });

  it("Q1 쓴 뒤 알림을 듣는 쪽이 던져도 저장은 성공으로 끝나고 flush도 reject되지 않는다", async () => {
    const { store, files } = casStore({ "a.md": "A\n" });
    const saver = new AutoSaver(store);
    const statuses: string[] = [];
    saver.onStatus((st) => statuses.push(st));
    saver.onWrite(() => {
      throw new Error("듣는 쪽 오류");
    });
    saver.schedule("a.md", "A1\n", "debounce", "A\n");
    await expect(saver.flush()).resolves.toBe(true);
    expect(files.get("a.md")).toBe("A1\n");
    expect(statuses.at(-1)).toBe("saved");
  });
});

describe("AutoSaver: 라운드 6 (리뷰 N4·N5, 오류 표시)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("N4 이미 '늦어짐'인 쓰기는 다음 flush가 다시 기다리지 않고 바로 false를 돌려준다", async () => {
    const s = slowCasStore({ "a.md": "A\n" });
    s.hold();
    const saver = new AutoSaver(s.store);
    saver.schedule("a.md", "A1\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    const first = saver.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await first).toBe(false);
    let second: boolean | undefined;
    void saver.flush().then((r) => (second = r));
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toBe(false);
  });

  it("N4 flush(path)는 그 파일만 쓰고 기다린다 — 다른 파일의 막힌 쓰기에 묶이지 않는다", async () => {
    const s = slowCasStore({ "a.md": "A\n", "b.md": "B\n" });
    const store: FileStore = {
      ...s.store,
      writeIf: (p, c, e) => (p === "a.md" ? new Promise(() => {}) : s.store.writeIf!(p, c, e)),
    };
    const saver = new AutoSaver(store);
    saver.schedule("a.md", "A1\n", "now", "A\n");
    saver.schedule("b.md", "B1\n", "debounce", "B\n");
    let result: boolean | undefined;
    void saver.flush("b.md").then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBe(true);
    expect(s.files.get("b.md")).toBe("B1\n");
  });

  it("N5 기준 없이 예약한 설정 저장은 앞 저장이 끝나도 기준을 얻지 않는다(조건 없이 쓴다)", async () => {
    const { store, files } = casStore({ "settings.json": "{}" });
    let release: (() => void) | null = null;
    const writeIfs: (string | null)[] = [];
    const gated: FileStore = {
      ...store,
      write: async (p, c) => {
        if (!release) await new Promise<void>((r) => (release = r));
        return store.write(p, c);
      },
      writeIf: async (p, c, e) => {
        writeIfs.push(e);
        return store.writeIf!(p, c, e);
      },
    };
    const saver = new AutoSaver(gated);
    saver.schedule("settings.json", "{\"a\":1}", "now");
    await vi.advanceTimersByTimeAsync(0);
    saver.schedule("settings.json", "{\"a\":2}", "now");
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(files.get("settings.json")).toBe("{\"a\":2}");
    expect(writeIfs).toEqual([]);
  });

  it("막혔던 쓰기가 끝나도 다른 파일이 재시도를 기다리고 있으면 '저장 실패'를 가리지 않는다", async () => {
    const s = slowCasStore({ "a.md": "A\n", "b.md": "B\n" });
    const store: FileStore = {
      ...s.store,
      writeIf: (p, c, e) => (p === "a.md" ? Promise.reject("EIO") : s.store.writeIf!(p, c, e)),
    };
    const saver = new AutoSaver(store);
    const statuses: string[] = [];
    saver.onStatus((st) => statuses.push(st));
    s.hold();
    saver.schedule("b.md", "B1\n", "now", "B\n");
    await vi.advanceTimersByTimeAsync(0);
    void saver.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    saver.schedule("a.md", "A1\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("error");
    s.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.files.get("b.md")).toBe("B1\n");
    expect(statuses.at(-1)).toBe("error");
  });
});

describe("AutoSaver: 라운드 7 (QA7-02·리뷰 N3·N5)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const failingA = (s: ReturnType<typeof slowCasStore>): FileStore => ({
    ...s.store,
    writeIf: (p, c, e) => (p === "a.md" ? Promise.reject("EIO") : s.store.writeIf!(p, c, e)),
  });

  it("QA7-02 다른 파일이 재시도를 기다리는 중에 새 편집을 예약해도 '저장 실패'를 '기다리는 중'으로 가리지 않는다", async () => {
    const s = slowCasStore({ "a.md": "A\n", "b.md": "B\n" });
    const saver = new AutoSaver(failingA(s));
    const statuses: string[] = [];
    saver.onStatus((st) => statuses.push(st));
    saver.schedule("a.md", "A1\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("error");
    saver.schedule("b.md", "B1\n", "debounce", "B\n");
    expect(statuses.at(-1)).toBe("error");
  });

  it("QA7-02 다른 파일이 재시도를 기다리는 중에 이 파일 저장이 성공하면 상태는 '저장 실패'다", async () => {
    const s = slowCasStore({ "a.md": "A\n", "b.md": "B\n", "c.md": "C\n" });
    const saver = new AutoSaver(failingA(s));
    const statuses: string[] = [];
    saver.onStatus((st) => statuses.push(st));
    saver.schedule("a.md", "A1\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    saver.schedule("c.md", "C1\n", "debounce", "C\n");
    saver.schedule("b.md", "B1\n", "now", "B\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.files.get("b.md")).toBe("B1\n");
    expect(statuses.at(-1)).toBe("error");
  });

  it("N3 flush(path)가 상한에 걸리면 기다린 그 파일만 '늦어짐'이 된다 — 다른 파일의 쓰는 중인 저장은 다음 flush가 기다린다", async () => {
    const s = slowCasStore({ "a.md": "A\n", "c.md": "C\n" });
    let releaseC: (() => void) | null = null;
    const store: FileStore = {
      ...s.store,
      writeIf: async (p, c, e) => {
        if (p === "a.md") return new Promise(() => {});
        if (!releaseC) await new Promise<void>((r) => (releaseC = r));
        return s.store.writeIf!(p, c, e);
      },
    };
    const saver = new AutoSaver(store);
    saver.schedule("c.md", "C1\n", "now", "C\n");
    saver.schedule("a.md", "A1\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    const first = saver.flush("a.md");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await first).toBe(false);
    let second: boolean | undefined;
    void saver.flush("c.md").then((r) => (second = r));
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toBeUndefined();
    releaseC!();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.files.get("c.md")).toBe("C1\n");
    expect(second).toBe(true);
  });
});

describe("AutoSaver: 라운드 8 (QA8 의심 ST2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ST2 실패한 파일의 재시도가 쓰는 중일 때 다른 파일 저장이 끝나도 '저장 실패'를 '기다리는 중'으로 가리지 않는다", async () => {
    const s = slowCasStore({ "a.md": "A\n", "b.md": "B\n" });
    let failA = true;
    let releaseA: (() => void) | null = null;
    const saver = new AutoSaver({
      ...s.store,
      writeIf: async (p, c, e) => {
        if (p === "a.md" && failA) throw "EIO";
        if (p === "a.md") await new Promise<void>((r) => (releaseA = r));
        return s.store.writeIf!(p, c, e);
      },
    });
    const statuses: string[] = [];
    saver.onStatus((st) => statuses.push(st));
    saver.schedule("a.md", "A1\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    failA = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(saver.writing("a.md")).toBe(true);
    saver.schedule("b.md", "B1\n", "now", "B\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.files.get("b.md")).toBe("B1\n");
    expect(statuses.at(-1)).toBe("error");
    releaseA!();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.files.get("a.md")).toBe("A1\n");
    expect(statuses.at(-1)).toBe("saved");
  });
});

describe("AutoSaver: 라운드 9 (QA9-06)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("QA9-06 실패해 재시도를 기다리는 파일을 계속 고쳐도, 그 파일 쓰기가 성공하기 전까지는 '저장 실패'다", async () => {
    const s = slowCasStore({ "a.md": "A\n" });
    let fail = true;
    const saver = new AutoSaver({
      ...s.store,
      writeIf: (p, c, e) => (fail ? Promise.reject("EIO") : s.store.writeIf!(p, c, e)),
    });
    const statuses: string[] = [];
    saver.onStatus((st) => statuses.push(st));
    saver.schedule("a.md", "A1\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("error");
    saver.schedule("a.md", "A12\n", "debounce", "A\n");
    expect(statuses.at(-1)).toBe("error");
    await vi.advanceTimersByTimeAsync(1000);
    saver.schedule("a.md", "A123\n", "debounce", "A\n");
    expect(statuses.at(-1)).toBe("error");
    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.files.get("a.md")).toBe("A123\n");
    expect(statuses.at(-1)).toBe("saved");
  });

  it("QA9-06 실패했던 기다리는 저장을 버리면(discard) 실패 표시도 함께 내린다", async () => {
    const s = slowCasStore({ "a.md": "A\n" });
    const saver = new AutoSaver({ ...s.store, writeIf: () => Promise.reject("EIO") });
    const statuses: string[] = [];
    saver.onStatus((st) => statuses.push(st));
    saver.schedule("a.md", "A1\n", "now", "A\n");
    await vi.advanceTimersByTimeAsync(0);
    saver.discard("a.md");
    saver.schedule("b.md", "B\n", "debounce");
    expect(statuses.at(-1)).toBe("pending");
  });
});
