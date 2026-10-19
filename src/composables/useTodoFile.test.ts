import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { AutoSaver } from "../core/autoSaver";
import { updateText } from "../core/todoList";
import type { FileStore } from "../platform/fileStore";
import { useTodoFile } from "./useTodoFile";

const PATH = "daily/2026-10-14.md";

/** 조건부 쓰기를 흉내 낸다. hold() 동안 쓰기가 끝나지 않는다("쓰는 중") */
function slowStore(initial: string) {
  const files = new Map([[PATH, initial]]);
  let gate: Promise<void> | null = null;
  let open: () => void = () => {};
  const store: FileStore = {
    read: async (p) => files.get(p) ?? null,
    write: async (p, c) => void files.set(p, c),
    writeIf: async (p, content, expected) => {
      if (gate) await gate;
      const current = files.get(p) ?? "";
      if (expected !== null && current !== expected) return { ok: false, current };
      files.set(p, content);
      return { ok: true, current: null };
    },
  };
  return {
    store,
    files,
    hold: () => (gate = new Promise<void>((r) => (open = r))),
    release: () => {
      gate = null;
      open();
    },
  };
}

async function setup(initial: string) {
  const s = slowStore(initial);
  const saver = new AutoSaver(s.store);
  const file = useTodoFile(ref(PATH), s.store, saver);
  await file.load();
  await nextTick();
  const edit = async (from: string, to: string) => {
    const item = file.items.value.find((i) => i.text === from)!;
    file.items.value = updateText(file.items.value, item.id, to);
    await nextTick();
  };
  return { ...s, saver, file, edit, texts: () => file.items.value.map((i) => i.text) };
}

describe("useTodoFile: 합쳐 쓴 직후의 기준 (리뷰 HIGH-1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("충돌로 합쳐 쓰는 도중 편집 1회, 쓰기가 끝난 뒤 1초 안에 편집 1회 — aru가 넣은 줄이 지워지지 않는다", async () => {
    const t = await setup("- [ ] 하나\n");
    await t.edit("하나", "하나 고침");
    t.hold();
    await vi.advanceTimersByTimeAsync(1000);
    // 쓰는 동안 aru가 X를 넣고, 사용자는 한 글자 더 친다
    t.files.set(PATH, "- [ ] 하나\n- [ ] X\n");
    await t.edit("하나 고침", "하나 고침!");
    t.release();
    await vi.advanceTimersByTimeAsync(0);
    // 쓰는 동안 친 글자 위에 X를 얹어 바로 다시 쓴다
    expect(t.files.get(PATH)).toBe("- [ ] 하나 고침!\n- [ ] X\n");
    // 화면도 X를 안다
    expect(t.texts()).toEqual(["하나 고침!", "X"]);
    // 1초 안에 또 친다
    await vi.advanceTimersByTimeAsync(300);
    await t.edit("하나 고침!", "하나 고침!!");
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.files.get(PATH)).toBe("- [ ] 하나 고침!!\n- [ ] X\n");
    // 3초 주기 다시 읽기도 그대로
    await t.file.reloadIfChanged();
    expect(t.texts()).toEqual(["하나 고침!!", "X"]);
  });
});

describe("useTodoFile: 쓰는 중인 저장이 있을 때 다시 읽기 (리뷰 HIGH-2 A)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("저장이 쓰이는 중에 바깥 변경을 읽어도 내 편집을 화면·파일에서 잃지 않는다", async () => {
    const t = await setup("- [ ] 하나\n");
    await t.edit("하나", "하나 고침");
    t.hold();
    await vi.advanceTimersByTimeAsync(1000);
    t.files.set(PATH, "- [ ] 하나\n- [ ] 모아보기에서\n");
    await t.file.reloadIfChanged();
    // 라운드 5(QA5 C1): 쓰는 중에는 합치지 않는다(내 저장이 이미 들어갔는지 몰라 낡은 기준으로 합치게 된다). 응답이 오면 들인다
    expect(t.texts()).toEqual(["하나 고침"]);
    t.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.texts()).toEqual(["하나 고침", "모아보기에서"]);
    await t.saver.flush();
    expect(t.files.get(PATH)).toBe("- [ ] 하나 고침\n- [ ] 모아보기에서\n");
    // 다음 편집도 둘 다 지닌다
    await t.edit("하나 고침", "하나 고침2");
    await t.saver.flush();
    expect(t.files.get(PATH)).toBe("- [ ] 하나 고침2\n- [ ] 모아보기에서\n");
  });
});

describe("useTodoFile: 라운드 4", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("리뷰 M1: 충돌 → 합친 쓰기 실패 → 바로 flush → 다음 편집에도 aru 줄이 남는다", async () => {
    const files = new Map([[PATH, "- [ ] 하나\n"]]);
    let calls = 0;
    const store: FileStore = {
      read: async (p) => files.get(p) ?? null,
      write: async (p, c) => void files.set(p, c),
      writeIf: async (p, content, expected) => {
        if (++calls === 2) throw "LOCKED: 저장 폴더가 잠겨 있어요";
        const current = files.get(p) ?? "";
        if (expected !== null && current !== expected) return { ok: false, current };
        files.set(p, content);
        return { ok: true, current: null };
      },
    };
    const saver = new AutoSaver(store);
    const file = useTodoFile(ref(PATH), store, saver);
    await file.load();
    const edit = async (from: string, to: string) => {
      const item = file.items.value.find((i) => i.text === from)!;
      file.items.value = updateText(file.items.value, item.id, to);
      await nextTick();
    };
    await edit("하나", "하나 고침");
    files.set(PATH, "- [ ] 하나\n- [ ] X\n");
    await vi.advanceTimersByTimeAsync(1000);
    // 창을 닫거나 가릴 때의 flush가 3초 다시 읽기보다 먼저 재시도한다
    await saver.flush();
    expect(files.get(PATH)).toBe("- [ ] 하나 고침\n- [ ] X\n");
    await edit("하나 고침", "하나 고침!");
    await saver.flush();
    expect(files.get(PATH)).toBe("- [ ] 하나 고침!\n- [ ] X\n");
    expect(file.items.value.map((i) => i.text)).toEqual(["하나 고침!", "X"]);
  });

  it("QA4-01: 날짜를 바꾸고 flush를 기다리는 동안 이전 날 목록을 고치면 그 날 파일로 간다(새 날 파일로 새지 않는다)", async () => {
    const A = PATH;
    const B = "daily/2026-10-15.md";
    const files = new Map([
      [A, "- [ ] 오늘 a\n- [ ] 오늘 b\n"],
      [B, "- [ ] 내일 x\n"],
    ]);
    let gate: Promise<void> | null = null;
    let open = () => {};
    const store: FileStore = {
      read: async (p) => files.get(p) ?? null,
      write: async (p, c) => void files.set(p, c),
      writeIf: async (p, content, expected) => {
        if (gate) await gate;
        const current = files.get(p) ?? "";
        if (expected !== null && current !== expected) return { ok: false, current };
        files.set(p, content);
        return { ok: true, current: null };
      },
    };
    const saver = new AutoSaver(store);
    const path = ref(A);
    const file = useTodoFile(path, store, saver);
    await file.load();
    const edit = async (from: string, to: string) => {
      const item = file.items.value.find((i) => i.text === from)!;
      file.items.value = updateText(file.items.value, item.id, to);
      await nextTick();
    };
    await edit("오늘 a", "오늘 a 고침");
    gate = new Promise<void>((r) => (open = r));
    // App의 watch(viewDate): flush를 기다린 뒤 새 날을 읽는다
    path.value = B;
    const switching = saver.flush().then(() => file.load());
    await vi.advanceTimersByTimeAsync(0);
    // 아직 화면에 남은 전날 목록을 고친다
    await edit("오늘 b", "오늘 b!");
    gate = null;
    open();
    await switching;
    await vi.advanceTimersByTimeAsync(2000);
    await saver.flush();
    expect(files.get(B)).toBe("- [ ] 내일 x\n");
    expect(files.get(A)).toBe("- [ ] 오늘 a 고침\n- [ ] 오늘 b!\n");
    expect(file.items.value.map((i) => i.text)).toEqual(["내일 x"]);
  });

  it("리뷰 질문(sync 메아리): 쓰는 중인 내 저장을 다시 읽어도 바깥 변경으로 보지 않는다 — 같은 줄이 둘이 되지 않는다", async () => {
    const files = new Map([[PATH, "- [ ] a\n"]]);
    let gate: Promise<void> | null = null;
    let open = () => {};
    const store: FileStore = {
      read: async (p) => files.get(p) ?? null,
      write: async (p, c) => void files.set(p, c),
      // 파일에는 이미 썼지만 응답은 아직 오지 않은 상태를 만든다(잠금 없는 읽기가 그 내용을 본다)
      writeIf: async (p, content, expected) => {
        const current = files.get(p) ?? "";
        if (expected !== null && current !== expected) return { ok: false, current };
        files.set(p, content);
        if (gate) await gate;
        return { ok: true, current: null };
      },
    };
    const saver = new AutoSaver(store);
    const file = useTodoFile(ref(PATH), store, saver);
    await file.load();
    const edit = async (from: string, to: string) => {
      const item = file.items.value.find((i) => i.text === from)!;
      file.items.value = updateText(file.items.value, item.id, to);
      await nextTick();
    };
    await edit("a", "ab");
    gate = new Promise<void>((r) => (open = r));
    await vi.advanceTimersByTimeAsync(1000);
    expect(files.get(PATH)).toBe("- [ ] ab\n");
    await edit("ab", "abc");
    await file.reloadIfChanged();
    gate = null;
    open();
    await vi.advanceTimersByTimeAsync(0);
    await saver.flush();
    expect(files.get(PATH)).toBe("- [ ] abc\n");
    expect(file.items.value.map((i) => i.text)).toEqual(["abc"]);
  });
});
