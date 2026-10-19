// 라운드 13 QA(QA13 Q13-1~12: B1·B2)와 12차 코드 리뷰(L-N4). QA13 시나리오(qa13-ui/a-round13·b-q5-variants)를 옮기고 리뷰 항목을 더했다
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fs, openApp, scenario } from "../harness.mjs";

const mock = readFileSync(new URL("../mockTauri.js", import.meta.url), "utf8");
const D14 = "daily/2026-10-14.md";
const J = JSON.stringify;
const PIN = '[aria-label="항상 위에 고정"]';
const addInput = (page, list = "today") => page.locator(`[data-list="${list}"] .add input`);
const count = async (page, needle) => Object.values(await fs(page)).reduce((k, v) => k + v.split(needle).length - 1, 0);
const settingsOf = async (page) => JSON.parse((await fs(page))["settings.json"] ?? "null");
const stash = (page) =>
  page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("aru.draft.")).map((k) => [k, localStorage.getItem(k)])));

/** quit_ready가 불리는 순간(=앱이 실제로 꺼지는 순간)의 디스크를 기록한다 */
async function armQuitSnapshot(page) {
  await page.evaluate(() => {
    const t = window.__TAURI_INTERNALS__;
    const orig = t.invoke.bind(t);
    t.invoke = async (c, a) => {
      if (c === "quit_ready" && !window.__atQuit) window.__atQuit = JSON.parse(JSON.stringify(window.__mockFs));
      return orig(c, a);
    };
  });
}
async function quit(page, ms = 3000) {
  await page.evaluate(() => window.__emit("quit-requested", null));
  await page.clock.runFor(ms);
}
async function restart(page, hash = "") {
  const loaded = page.waitForEvent("load");
  await page.evaluate((h) => {
    history.replaceState(null, "", `/${h}`);
    location.reload();
  }, hash);
  await loaded;
  await page.waitForSelector(hash.startsWith("#quick") ? ".quick" : ".foot");
  await page.clock.runFor(1000);
}

const log = {};

export default async function (browser) {
  const base = { carryOver: "keep", alwaysOnTop: true, opacity: 100, allowExternalAdd: true, lastRolloverDate: "2026-10-14" };

  // ── 라운드 13 수정 확인 ──
  await scenario("Q13-1 (B2 확인) 다른 맥이 AI 추가를 끈 직후 이 창에서 핀 → 둘 다 남고, 다시 켜도 유지", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "settings.json": J(base) } });
    await page.clock.runFor(3500);
    await page.evaluate(() => {
      const s = JSON.parse(window.__mockFs["settings.json"]);
      window.__setFile("settings.json", JSON.stringify({ ...s, allowExternalAdd: false, carryOver: "someday" }));
    });
    await page.locator(PIN).click();
    await page.clock.runFor(500);
    const s1 = await settingsOf(page);
    await restart(page);
    await page.clock.runFor(4000);
    const s2 = await settingsOf(page);
    log.q1 = { s1, s2 };
    for (const s of [s1, s2]) {
      assert.equal(s.alwaysOnTop, false, J(log.q1));
      assert.equal(s.allowExternalAdd, false, J(log.q1));
      assert.equal(s.carryOver, "someday", J(log.q1));
    }
    await context.close();
  });

  await scenario("Q13-2 (M-N1 확인) settings.json이 잠깐 없어졌다가 다른 맥 값으로 다시 생김 → 새 값을 따라가고 기본값으로 덮지 않는다", async () => {
    const real = { ...base, opacity: 40, allowExternalAdd: false };
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "settings.json": J(real) } });
    await page.clock.runFor(1000);
    await page.evaluate(() => window.__setFile("settings.json", null));
    await page.clock.runFor(4000);
    const mid = await settingsOf(page);
    await page.evaluate((c) => window.__setFile("settings.json", c), J({ ...real, carryOver: "next-day" }));
    await page.clock.runFor(4000);
    await page.locator(PIN).click();
    await page.clock.runFor(1500);
    const after = await settingsOf(page);
    log.q2 = { mid, after };
    assert.equal(mid, null, "없는 동안 앱이 스스로 파일을 다시 씀 " + J(log.q2));
    assert.deepEqual(
      { o: after.opacity, a: after.allowExternalAdd, c: after.carryOver, p: after.alwaysOnTop },
      { o: 40, a: false, c: "next-day", p: false },
      J(log.q2),
    );
    await context.close();
  });

  await scenario("Q13-3 (확인) 투명도 끄는 중(debounce 1초) 다른 맥이 carryOver·AI 추가를 바꿈, 파일 변경 알림 있음 → 둘 다 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "settings.json": J(base) } });
    await page.clock.runFor(3500);
    await page.locator('input[type="range"]').fill("40");
    await page.clock.runFor(50);
    await page.evaluate(() => {
      const s = JSON.parse(window.__mockFs["settings.json"]);
      window.__setFile("settings.json", JSON.stringify({ ...s, allowExternalAdd: false, carryOver: "someday" }));
      window.__emit("file-changed", { path: "settings.json", source: "cli" });
    });
    await page.clock.runFor(1500);
    const after = await settingsOf(page);
    log.q3 = after;
    assert.deepEqual({ o: after.opacity, a: after.allowExternalAdd, c: after.carryOver }, { o: 40, a: false, c: "someday" }, J(after));
    await context.close();
  });

  await scenario("Q13-4 (B1) 투명도 끄는 중(debounce 1초) 다른 맥이 바꿈, 알림이 1초 안에 안 옴(3초 확인 전) → 쓰는 순간 다시 읽어 다른 맥 값을 되돌리지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "settings.json": J(base) } });
    await page.clock.runFor(3500);
    await page.locator('input[type="range"]').fill("40");
    await page.clock.runFor(50);
    await page.evaluate(() => {
      const s = JSON.parse(window.__mockFs["settings.json"]);
      window.__setFile("settings.json", JSON.stringify({ ...s, allowExternalAdd: false, carryOver: "someday" }));
    });
    await page.clock.runFor(1200);
    const at1s = await settingsOf(page);
    await page.clock.runFor(6000);
    const after = await settingsOf(page);
    log.q4 = { at1s, after };
    assert.deepEqual({ o: after.opacity, a: after.allowExternalAdd, c: after.carryOver }, { o: 40, a: false, c: "someday" }, J(log.q4));
    await context.close();
  });

  // 읽기 5초면 종료 저장이 그 읽기를 기다리므로 quit_ready도 그만큼 늦게 불린다(종료 저장 상한 10초 안)
  await scenario("Q13-5 (B2) 느린 폴더(읽기 5초, iCloud 내려받기)에서 핀을 끄고 1초 뒤 종료 → 꺼질 때 디스크에 핀 꺼짐이 남고, 쓰기 전에는 저장됨이 아니다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "settings.json": J(base) } });
    await page.clock.runFor(3500);
    await armQuitSnapshot(page);
    await page.evaluate(() => (window.__readDelay = 5000));
    await page.locator(PIN).click();
    await page.clock.runFor(1000);
    const statusText = (await page.locator(".foot .status").textContent()).trim();
    await quit(page, 6000);
    const atQuit = await page.evaluate(() => window.__atQuit);
    log.q5 = { statusText, atQuitPin: atQuit && JSON.parse(atQuit["settings.json"]).alwaysOnTop };
    assert.ok(atQuit, "quit_ready가 불리지 않음 " + J(log.q5));
    assert.equal(JSON.parse(atQuit["settings.json"]).alwaysOnTop, false, "종료 시점 디스크에 바꾼 핀이 없음 " + J(log.q5));
    assert.notEqual(statusText, "저장됨", J(log.q5));
    await context.close();
  });

  for (const [delay, wait] of [[0, 100], [300, 100], [5000, 1000]]) {
    await scenario(`Q13-5v (B2) 읽기 ${delay}ms, 핀 후 ${wait}ms에 종료 → 종료 순간 디스크에 핀 꺼짐`, async () => {
      const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "settings.json": J(base) } });
      await page.clock.runFor(3500);
      await armQuitSnapshot(page);
      await page.evaluate((d) => (window.__readDelay = d), delay);
      await page.locator(PIN).click();
      await page.clock.runFor(wait);
      await quit(page, delay + 1000);
      const atQuit = await page.evaluate(() => window.__atQuit);
      assert.equal(atQuit && JSON.parse(atQuit["settings.json"]).alwaysOnTop, false, J(atQuit));
      await context.close();
    });
  }

  await scenario("L-N4 쓰기 직전 다시 읽기가 잠깐 실패해도(EIO) 바꾼 핀을 버리지 않고 쓴다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "settings.json": J(base) } });
    await page.clock.runFor(3500);
    await page.evaluate(() => (window.__flakyReads = ["settings.json"]));
    await page.locator(PIN).click();
    await page.clock.runFor(500);
    await page.evaluate(() => (window.__flakyReads = []));
    const s = await settingsOf(page);
    await page.clock.runFor(4000);
    assert.equal(s.alwaysOnTop, false, J(s));
    assert.equal((await settingsOf(page)).alwaysOnTop, false);
    await context.close();
  });

  await scenario("Q13-6 (탐색) 느린 폴더에서 연속 설정 변경(핀 끔 → 투명도 50) → 읽기가 끝나면 둘 다 쓰인다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "settings.json": J(base) } });
    await page.clock.runFor(3500);
    await page.evaluate(() => (window.__readDelay = 3000));
    await page.locator(PIN).click();
    await page.clock.runFor(300);
    await page.locator('input[type="range"]').fill("50");
    await page.clock.runFor(9000);
    const after = await settingsOf(page);
    log.q6 = after;
    assert.deepEqual({ p: after.alwaysOnTop, o: after.opacity, a: after.allowExternalAdd }, { p: false, o: 50, a: true }, J(after));
    await context.close();
  });

  // ── 넘길 글 중복 건너뜀 ──
  await scenario("Q13-7 넘길 글 끝 공백·NBSP·앞 공백만 다른 같은 할 일 → 건너뜀(한 줄), 다른 글은 들어감", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] 우유 사기\n- [x] 끝낸일\n" } });
    await page.evaluate(() => {
      localStorage.setItem("aru.draft.quick.someday", "  우유 사기 \n끝낸일\n새글");
    });
    await restart(page);
    await page.clock.runFor(3500);
    await quit(page);
    const sd = (await fs(page))["someday.md"];
    log.q7 = { sd, stash: await stash(page) };
    assert.equal(sd.split("우유 사기").length - 1, 1, J(log.q7));
    assert.equal(sd.split("끝낸일").length - 1, 2, "끝낸 같은 일이 있으면 새로 넣어야 함 " + J(log.q7));
    assert.ok(sd.includes("새글"), J(log.q7));
    assert.deepEqual(log.q7.stash, {}, J(log.q7));
    await context.close();
  });

  await scenario("Q13-8 넘길 글(⌥Space 오늘) 중복 판정이 AI 표시가 붙은 같은 할 일도 같은 일로 본다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] 회의 준비 <!-- ai:claude@1760400000 -->\n" } });
    await page.evaluate(() => localStorage.setItem("aru.draft.quick.today", "회의 준비"));
    await restart(page);
    await page.clock.runFor(3500);
    await quit(page);
    const d = (await fs(page))[D14];
    log.q8 = d;
    assert.equal(d.split("회의 준비").length - 1, 1, J(d));
    await context.close();
  });

  // ── 스윕: 재시작·두 창·자정·빠른 추가 ──
  await scenario("Q13-9 재시작 3회 사이클: 입력칸 글 + ⌥Space 저장 실패 글 + 설정 변경 → 각각 한 번, 설정 유지", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n", "settings.json": J(base) } });
    await page.clock.runFor(1000);
    await addInput(page).click();
    await page.keyboard.type("입력중글");
    await page.locator(PIN).click();
    await page.evaluate(() => localStorage.setItem("aru.draft.quick.someday", "퀵실패글"));
    await quit(page);
    for (let i = 0; i < 3; i++) {
      await restart(page);
      await page.clock.runFor(4000);
      await quit(page);
    }
    log.q9 = { fs: await fs(page), stash: await stash(page) };
    assert.equal(await count(page, "입력중글"), 1, J(log.q9));
    assert.equal(await count(page, "퀵실패글"), 1, J(log.q9));
    assert.equal((await settingsOf(page)).alwaysOnTop, false, J(log.q9));
    await context.close();
  });

  await scenario("Q13-10 자정: 핀을 바꾼 직후(재읽기 중) 자정 정리(next-day) → 할 일은 한 번만 옮겨지고 핀·정리 기록 모두 남는다", async () => {
    const { page, context } = await openApp(browser, {
      now: "2026-10-14T23:59:58",
      files: { [D14]: "- [ ] 넘길일\n", "settings.json": J({ ...base, carryOver: "next-day" }) },
    });
    await page.clock.runFor(1000);
    await page.evaluate(() => (window.__readDelay = 1500));
    await page.locator(PIN).click();
    await page.clock.runFor(8000);
    await page.evaluate(() => (window.__readDelay = 0));
    await page.clock.runFor(4000);
    await quit(page);
    const s = await settingsOf(page);
    const f = await fs(page);
    log.q10 = { s, f };
    assert.equal(s.alwaysOnTop, false, J(log.q10));
    assert.equal(s.lastRolloverDate, "2026-10-15", J(log.q10));
    assert.equal(await count(page, "넘길일"), 1, J(log.q10));
    assert.ok((f["daily/2026-10-15.md"] ?? "").includes("넘길일"), J(log.q10));
    await context.close();
  });

  await scenario("Q13-11 두 창(모아보기 페이지는 모의 fs가 따로라 작은 창 쪽만 판정): 모아보기가 열린 채 작은 창에서 핀, 다른 맥이 carryOver를 바꿈 → 모아보기 새로 읽기 후에도 파일에 둘 다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "settings.json": J(base) } });
    const ov = await context.newPage();
    await ov.addInitScript(mock);
    await ov.clock.install({ time: new Date("2026-10-14T10:00:01") });
    await ov.goto("http://localhost:1430/#overview");
    await ov.waitForSelector(".foot, .overview, body");
    await ov.clock.runFor(1000);
    await page.clock.runFor(3500);
    await page.evaluate(() => {
      const s = JSON.parse(window.__mockFs["settings.json"]);
      window.__setFile("settings.json", JSON.stringify({ ...s, carryOver: "someday" }));
    });
    await page.locator(PIN).click();
    await page.clock.runFor(4000);
    await ov.clock.runFor(4000);
    const after = await settingsOf(page);
    log.q11 = after;
    assert.deepEqual({ p: after.alwaysOnTop, c: after.carryOver }, { p: false, c: "someday" }, J(after));
    await ov.close();
    await context.close();
  });

  await scenario("Q13-12 빠른 추가: 작은 창에서 같은 날을 편집 중(1초 debounce)인데 ⌥Space(다른 프로세스)가 오늘 맨 위에 추가 → 둘 다 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n" } });
    await page.clock.runFor(1000);
    await addInput(page).click();
    await page.keyboard.type("메인글");
    await page.keyboard.press("Enter");
    await page.clock.runFor(200);
    await page.evaluate((p) => {
      window.__setFile(p, "- [ ] 퀵글\n" + (window.__mockFs[p] ?? ""));
      window.__emit("file-changed", { path: p, source: "quick" });
    }, D14);
    await page.clock.runFor(4000);
    await quit(page);
    log.q12 = (await fs(page))[D14];
    assert.ok(log.q12.includes("메인글") && log.q12.includes("퀵글"), J(log.q12));
    assert.equal(log.q12.split("퀵글").length - 1, 1);
    assert.equal(log.q12.split("메인글").length - 1, 1);
    await context.close();
  });
}
