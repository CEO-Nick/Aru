import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { AutoSaver } from "../core/autoSaver";
import type { FileStore } from "../platform/fileStore";
import { ROOT_UNAVAILABLE } from "./useStorageHealth";
import { useSettings } from "./useSettings";

function store(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  let failWrites = false;
  let badRead = false;
  const s: FileStore = {
    read: async (p) => {
      if (badRead) throw "글자로 풀 수 없는 파일이에요 (UTF-8이 아니에요)";
      return files.get(p) ?? null;
    },
    write: async (p, c) => {
      if (failWrites) throw `${ROOT_UNAVAILABLE}: /Volumes/USB`;
      files.set(p, c);
    },
  };
  return { files, store: s, failWrites: (on: boolean) => (failWrites = on), badRead: (on: boolean) => (badRead = on) };
}

const json = (v: object) => JSON.stringify(v);

describe("다른 폴더의 설정을 다시 읽기 (리뷰 N6)", () => {
  it("쓰지 못한 채 바꾼 값만 새 폴더 설정 위에 얹고, 나머지는 새 폴더 값을 쓴다", async () => {
    const m = store({ "settings.json": json({ opacity: 100, alwaysOnTop: true }) });
    const saver = new AutoSaver(m.store);
    const { settings, load } = useSettings(m.store, saver);
    await load();
    m.failWrites(true);
    settings.value.opacity = 50;
    await nextTick();
    await saver.flush();
    m.failWrites(false);
    saver.discard("settings.json");
    m.files.set("settings.json", json({ opacity: 40, alwaysOnTop: false, allowExternalAdd: false }));
    await load();
    expect(settings.value.opacity).toBe(50);
    expect(settings.value.alwaysOnTop).toBe(false);
    expect(settings.value.allowExternalAdd).toBe(false);
  });

  it("이미 파일에 쓴 값은 내가 바꾼 것으로 보지 않는다 — 새 폴더 값이 이긴다", async () => {
    const m = store({ "settings.json": json({ opacity: 100 }) });
    const saver = new AutoSaver(m.store);
    const { settings, load } = useSettings(m.store, saver);
    await load();
    settings.value.opacity = 50;
    await nextTick();
    // 쓰기 직전에 다시 읽는 한 틱(QA12 B2)
    await new Promise((r) => setTimeout(r, 0));
    await saver.flush();
    m.files.set("settings.json", json({ opacity: 40 }));
    await load();
    expect(settings.value.opacity).toBe(40);
  });

  it("QA8-02 폴더를 열 수 없는 동안 자정 정리가 바꾼 lastRolloverDate는 사용자 설정이 아니다 — 새 폴더 값을 쓴다", async () => {
    const m = store({ "settings.json": json({ carryOver: "keep", lastRolloverDate: "2026-10-14" }) });
    const saver = new AutoSaver(m.store);
    const { settings, load } = useSettings(m.store, saver);
    await load();
    m.failWrites(true);
    settings.value.lastRolloverDate = "2026-10-15";
    await nextTick();
    await saver.flush();
    m.failWrites(false);
    saver.discard("settings.json");
    m.files.set("settings.json", json({ carryOver: "next-day", lastRolloverDate: "2026-10-12" }));
    await load();
    expect(settings.value.lastRolloverDate).toBe("2026-10-12");
    expect(settings.value.carryOver).toBe("next-day");
  });
});

describe("라운드 9 (QA9-03·04)", () => {
  it("QA9-03 설정 파일이 없는 폴더로 바꾸면 이 창의 설정을 그대로 두고 그 폴더에 쓴다", async () => {
    const mine = { opacity: 40, alwaysOnTop: false, sortChecked: false, allowExternalAdd: false, carryOver: "next-day", lastRolloverDate: "2026-10-14" };
    const m = store({ "settings.json": json(mine) });
    const saver = new AutoSaver(m.store);
    const { settings, load } = useSettings(m.store, saver);
    await load();
    m.files.delete("settings.json");
    saver.discard("settings.json");
    await load({ adopt: true });
    await nextTick();
    await saver.flush();
    expect(settings.value).toMatchObject({ opacity: 40, alwaysOnTop: false, sortChecked: false, allowExternalAdd: false, carryOver: "next-day" });
    const written = JSON.parse(m.files.get("settings.json") ?? "null");
    expect(written).toMatchObject({ opacity: 40, alwaysOnTop: false, allowExternalAdd: false, carryOver: "next-day" });
    // 그 폴더의 할 일을 어디까지 정리했는지는 이 창이 모른다
    expect(written.lastRolloverDate).toBeNull();
  });

  it("QA9-03 처음 켤 때 설정 파일이 없으면 기본값이고 파일을 만들지 않는다", async () => {
    const m = store({});
    const saver = new AutoSaver(m.store);
    const { settings, load } = useSettings(m.store, saver);
    await load();
    await nextTick();
    await saver.flush();
    expect(settings.value.allowExternalAdd).toBe(true);
    expect(m.files.has("settings.json")).toBe(false);
  });

  it("QA9-04 설정 파일을 못 읽는 동안 바꾼 값은 파일이 다시 읽혀도 버리지 않고 그 위에 얹는다", async () => {
    const m = store({ "settings.json": "BAD" });
    m.badRead(true);
    const saver = new AutoSaver(m.store);
    const { settings, load, recover } = useSettings(m.store, saver);
    await load();
    settings.value.opacity = 30;
    await nextTick();
    m.badRead(false);
    m.files.set("settings.json", json({ opacity: 70, allowExternalAdd: false }));
    await recover();
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
    await saver.flush();
    expect(settings.value.opacity).toBe(30);
    expect(settings.value.allowExternalAdd).toBe(false);
    expect(JSON.parse(m.files.get("settings.json")!).opacity).toBe(30);
  });

  it("N1 켤 때 폴더가 늦게 붙고 settings.json이 아직 없으면(iCloud) 이 창의 기본값을 쓰지 않는다 — 폴더를 바꿀 때만 쓴다", async () => {
    const m = store({});
    m.failWrites(true);
    const saver = new AutoSaver(m.store);
    const s = m.store;
    let mounted = false;
    const late: FileStore = {
      read: async (p) => {
        if (!mounted) throw `${ROOT_UNAVAILABLE}: /iCloud`;
        return s.read(p);
      },
      write: s.write,
    };
    const { settings, load, recover } = useSettings(late, saver);
    await load();
    mounted = true;
    m.failWrites(false);
    await recover();
    // 자정 정리 기록만 바뀐 것도 쓰지 않는다(아직 오지 않은 진짜 설정을 기본값으로 덮는다)
    settings.value.lastRolloverDate = "2026-10-14";
    await nextTick();
    await saver.flush();
    expect(m.files.has("settings.json")).toBe(false);
    // 사용자가 직접 바꾼 값은 쓴다
    settings.value.opacity = 40;
    await nextTick();
    // 처음 쓰기 전에 파일이 그새 내려왔는지 한 번 더 읽는다(리뷰 M1)
    await new Promise((r) => setTimeout(r, 0));
    await saver.flush();
    expect(JSON.parse(m.files.get("settings.json")!)).toMatchObject({ opacity: 40, lastRolloverDate: "2026-10-14" });
  });
});

describe("주 창도 설정 파일을 다시 읽는다 (리뷰 M1, QA11 B3)", () => {
  const read = (m: ReturnType<typeof store>) => JSON.parse(m.files.get("settings.json")!);
  const settle = async (saver: AutoSaver) => {
    for (let i = 0; i < 5; i++) await nextTick();
    await new Promise((r) => setTimeout(r, 5));
    await saver.flush();
  };

  it("켤 때 없던 settings.json이 늦게 내려온 뒤 투명도를 바꾸면, 쓰기 직전에 다시 읽어 진짜 값 위에 그 값만 얹는다", async () => {
    const m = store({});
    const saver = new AutoSaver(m.store);
    const { settings, load } = useSettings(m.store, saver);
    await load();
    m.files.set("settings.json", json({ carryOver: "next-day", allowExternalAdd: false, opacity: 40, lastRolloverDate: "2026-10-14" }));
    settings.value.opacity = 70;
    await settle(saver);
    expect(read(m)).toMatchObject({ carryOver: "next-day", allowExternalAdd: false, opacity: 70, lastRolloverDate: "2026-10-14" });
    expect(settings.value.carryOver).toBe("next-day");
  });

  it("다른 창·다른 맥이 바꾼 설정을 refresh로 받아 온 뒤 하나를 바꾸면 받은 값을 덮지 않는다. 그대로면 쓰지 않는다", async () => {
    const m = store({ "settings.json": json({ opacity: 100, allowExternalAdd: true, carryOver: "keep" }) });
    const saver = new AutoSaver(m.store);
    const writes: string[] = [];
    saver.onWrite((p) => writes.push(p));
    const { settings, load, refresh } = useSettings(m.store, saver);
    await load();
    await refresh();
    await settle(saver);
    expect(writes).toEqual([]);
    m.files.set("settings.json", json({ opacity: 100, allowExternalAdd: false, carryOver: "next-day" }));
    await refresh();
    expect(settings.value.allowExternalAdd).toBe(false);
    settings.value.alwaysOnTop = false;
    await settle(saver);
    expect(read(m)).toMatchObject({ allowExternalAdd: false, carryOver: "next-day", alwaysOnTop: false });
  });

  it("아직 쓰지 못한 이 창의 변경(자정 정리 기록 포함)은 refresh가 받아 온 값 위에 남는다", async () => {
    const m = store({ "settings.json": json({ opacity: 100, lastRolloverDate: "2026-10-13" }) });
    const saver = new AutoSaver(m.store);
    const { settings, load, refresh } = useSettings(m.store, saver);
    await load();
    m.failWrites(true);
    settings.value.opacity = 30;
    settings.value.lastRolloverDate = "2026-10-14";
    await settle(saver);
    m.files.set("settings.json", json({ opacity: 100, lastRolloverDate: "2026-10-13", sortChecked: false }));
    await refresh();
    expect(settings.value).toMatchObject({ opacity: 30, lastRolloverDate: "2026-10-14", sortChecked: false });
  });
});

describe("라운드 13 (리뷰 M-N1, QA12 B2)", () => {
  const read = (m: ReturnType<typeof store>) => JSON.parse(m.files.get("settings.json")!);
  const settle = async (saver: AutoSaver) => {
    for (let i = 0; i < 5; i++) await nextTick();
    await new Promise((r) => setTimeout(r, 5));
    await saver.flush();
  };
  const real = { opacity: 40, carryOver: "next-day", allowExternalAdd: false, lastRolloverDate: "2026-10-14" };

  it("M-N1 읽은 적 있는 settings.json이 잠깐 없어져도(iCloud 내려 둠) 기본값으로 내려가지 않고, 그 뒤 바꾸면 진짜 설정 위에 쓴다", async () => {
    const m = store({ "settings.json": json(real) });
    const saver = new AutoSaver(m.store);
    const { settings, load, refresh } = useSettings(m.store, saver);
    await load();
    m.files.delete("settings.json");
    await refresh();
    expect(settings.value).toMatchObject(real);
    settings.value.alwaysOnTop = false;
    await settle(saver);
    expect(read(m)).toMatchObject({ ...real, alwaysOnTop: false });
  });

  it("B2 다른 맥이 바꾼 직후(3초 확인 전) 이 창에서 하나를 바꾸면, 쓰기 직전에 다시 읽어 받은 값을 덮지 않는다", async () => {
    const m = store({ "settings.json": json({ opacity: 100, carryOver: "keep", allowExternalAdd: true }) });
    const saver = new AutoSaver(m.store);
    const { settings, load } = useSettings(m.store, saver);
    await load();
    m.files.set("settings.json", json({ opacity: 100, carryOver: "next-day", allowExternalAdd: false }));
    settings.value.alwaysOnTop = false;
    await settle(saver);
    expect(read(m)).toMatchObject({ carryOver: "next-day", allowExternalAdd: false, alwaysOnTop: false });
    expect(settings.value).toMatchObject({ carryOver: "next-day", allowExternalAdd: false, alwaysOnTop: false });
  });
});

describe("라운드 14 (QA13 B1·B2, 리뷰 L-N4)", () => {
  const read = (files: Map<string, string>) => JSON.parse(files.get("settings.json")!);
  const ticks = async () => {
    for (let i = 0; i < 5; i++) await nextTick();
  };
  const base = { opacity: 100, carryOver: "keep", allowExternalAdd: true, alwaysOnTop: true, lastRolloverDate: "2026-10-14" };

  it("B1 투명도를 끄는 1초 사이에 다른 맥이 바꾼 값은, 쓰는 순간 다시 읽어 남기고 바꾼 투명도만 얹는다", async () => {
    const m = store({ "settings.json": json(base) });
    const saver = new AutoSaver(m.store);
    const { settings, load } = useSettings(m.store, saver);
    await load();
    settings.value.opacity = 40;
    await ticks();
    m.files.set("settings.json", json({ ...base, carryOver: "someday", allowExternalAdd: false }));
    await saver.flush();
    expect(read(m.files)).toMatchObject({ opacity: 40, carryOver: "someday", allowExternalAdd: false });
    expect(settings.value).toMatchObject({ opacity: 40, carryOver: "someday", allowExternalAdd: false });
  });

  it("B2 읽기가 느린 폴더에서 바꾼 직후 종료 저장(flush)이 그 다시 읽기와 쓰기를 기다리고, 쓰기 전에는 저장됨이 아니다", async () => {
    const m = store({ "settings.json": json(base) });
    let delay = 0;
    const slow: FileStore = { ...m.store, read: async (p) => (await new Promise((r) => setTimeout(r, delay)), m.store.read(p)) };
    const saver = new AutoSaver(slow);
    const statuses: string[] = [];
    saver.onStatus((s) => statuses.push(s));
    const { settings, load } = useSettings(slow, saver);
    await load();
    delay = 50;
    settings.value.alwaysOnTop = false;
    await ticks();
    expect(saver.idle()).toBe(false);
    expect(statuses.at(-1)).not.toBe("saved");
    expect(await saver.flush()).toBe(true);
    expect(read(m.files).alwaysOnTop).toBe(false);
  });

  it("L-N4 쓰기 직전 다시 읽기가 잠깐 실패해도 지금 값(자정 정리 기록 포함)으로 쓴다", async () => {
    const m = store({ "settings.json": json(base) });
    const saver = new AutoSaver(m.store);
    const { settings, load, error } = useSettings(m.store, saver);
    await load();
    m.badRead(true);
    settings.value.lastRolloverDate = "2026-10-15";
    settings.value.rolloverPending = ["2026-10-14"];
    await ticks();
    await saver.flush();
    m.badRead(false);
    expect(read(m.files)).toMatchObject({ lastRolloverDate: "2026-10-15", rolloverPending: ["2026-10-14"] });
    expect(error.value).toBeNull();
  });
});
