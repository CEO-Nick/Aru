// 라운드 9 QA(QA9-01~06, 의심 AI9-9·빠른 입력)와 8차 코드 리뷰(D4·D5·D7)에서 나온 경우들. QA9 시나리오(qa9-ui)를 옮기고 리뷰 항목을 더했다
import assert from "node:assert/strict";
import { calls, caretToEnd, fs, openApp, reload, scenario, status, texts } from "../harness.mjs";

const D14 = "daily/2026-10-14.md";
const D15 = "daily/2026-10-15.md";
const TODAY = D14;
const J = JSON.stringify;
const BEFORE = "2026-10-14T23:59:30";
const FAILED = "저장 실패 — 다시 시도합니다";

const st = (carryOver, last = "2026-10-14") => J({ carryOver, lastRolloverDate: last });
const addInput = (page, list = "today") => page.locator(`[data-list="${list}"] .add input`);
const itemText = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .text`).nth(i);
const footText = async (page) => (await page.locator(".foot").textContent()).replace(/\s+/g, " ").trim();
const dateLabel = async (page) => (await page.locator(".datebar .date").textContent()).trim();
const settingsOf = async (page) => JSON.parse((await fs(page))["settings.json"] ?? "null");
const range = (page) => page.locator('input[type="range"]');
const lastAlpha = async (page) => (await calls(page, "set_window_opacity")).at(-1)?.alpha;
const lastPin = async (page) => (await calls(page, "plugin:window|set_always_on_top")).at(-1)?.value;
const btn = (page, action) => page.locator(`[data-action="connect-${action}"]`);
const label = async (page, action) => (await btn(page, action).textContent()).trim();
const connectText = async (page) => (await page.locator(".connect").innerText()).replace(/\s+/g, " ");
const where = async (page, needle) =>
  Object.entries(await fs(page))
    .filter(([, v]) => v.includes(needle))
    .map(([k]) => k);

async function openSettings(page, { clipboardFails = false } = {}) {
  await page.evaluate((fails) => {
    navigator.clipboard.writeText = async (t) => {
      if (fails) throw new Error("denied");
      window.__copied = t;
    };
  }, clipboardFails);
  await page.locator('[aria-label="설정"]').click();
  await page.clock.runFor(10);
}

async function midnight(page, fault, draft = "쓰다만") {
  if (draft) {
    await addInput(page).click();
    await page.keyboard.type(draft);
  }
  await page.evaluate(([key, p]) => (window[key] = [p]), [fault, D15]);
  await page.clock.runFor(60_000);
}

/** 설정의 "폴더 변경…"이 고를 폴더와 결과. newFiles를 주면 모의 저장소(폴더가 하나)를 새 폴더 내용으로 바꾼다 */
async function prepareSwitch(page, { copied, reason, newFiles = null }) {
  await page.evaluate(
    ({ copied, reason, newFiles }) => {
      window.__setRootEmits = true;
      window.__setRootCopied = copied;
      window.__setRootReason = reason;
      window.__pickResult = "/Users/me/Dropbox/todo";
      if (newFiles) {
        for (const k of Object.keys(window.__mockFs)) window.__setFile(k, null);
        for (const [k, v] of Object.entries(newFiles)) window.__setFile(k, v);
      }
    },
    { copied, reason, newFiles },
  );
}

/** 설정 화면에서 폴더를 바꾸고 새로고침된 창이 뜰 때까지 기다린다 */
async function changeFolder(page) {
  await page.locator('[data-action="change-folder"]').click();
  // 새로고침되는 도중이면 시계 진행이 끊길 수 있다
  await page.clock.runFor(3000).catch(() => {});
  await page.waitForSelector(".foot");
  await page.clock.runFor(3000);
}

export default async function (browser) {
  // ── QA9-01·리뷰 D4: 미뤄진 자정 정리는 오늘로 돌아오면(3초 확인·포커스) 다시 해 본다 ──
  for (const policy of ["next-day", "someday"]) {
    await scenario(`QA9-01[${policy}] 자정에 새 날을 잠깐 못 읽음 → ◀로 어제를 보다가 읽기가 돌아온 뒤 '오늘'로 오면 미룬 정리가 돈다`, async () => {
      const { page, context, errors } = await openApp(browser, {
        now: BEFORE,
        files: { "settings.json": st(policy), [D14]: "- [ ] 원래\n", [D15]: "- [ ] 미리\n" },
      });
      await midnight(page, "__flakyReads");
      assert.match((await fs(page))[D14] ?? "", /쓰다만/, "자정 규칙 전제: 떠나는 날에 들어감");
      await page.locator('[aria-label="이전 날"]').click();
      await page.clock.runFor(2000);
      await page.evaluate(() => (window.__flakyReads = []));
      await page.clock.runFor(10_000);
      await page.locator(".today-btn").click();
      await page.clock.runFor(10_000);
      const f = await fs(page);
      const dest = policy === "next-day" ? D15 : "someday.md";
      const detail = J({ D14: f[D14], D15: f[D15], someday: f["someday.md"], last: (await settingsOf(page)).lastRolloverDate });
      assert.match(f[dest] ?? "", /- \[ \] 원래/, detail);
      assert.match(f[dest] ?? "", /- \[ \] 쓰다만/, detail);
      assert.equal((await settingsOf(page)).lastRolloverDate, "2026-10-15", detail);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  await scenario("QA9-01b[next-day] 같은 상황에서 ◀ 없이 '오늘'에 머물면(대조) 정리된다", async () => {
    const { page, context } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("next-day"), [D14]: "- [ ] 원래\n", [D15]: "- [ ] 미리\n" },
    });
    await midnight(page, "__flakyReads");
    await page.clock.runFor(2000);
    await page.evaluate(() => (window.__flakyReads = []));
    await page.clock.runFor(10_000);
    const f = await fs(page);
    assert.match(f[D15] ?? "", /원래/);
    assert.match(f[D15] ?? "", /쓰다만/);
    await context.close();
  });

  await scenario("QA9-01c[next-day] 입력칸 글 없이: 새 날 못 읽음 → ◀ → 읽기 회복 → ▶ 오늘. 지난 할 일이 다음 날로 옮겨진다", async () => {
    const { page, context } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("next-day"), [D14]: "- [ ] 원래\n", [D15]: "- [ ] 미리\n" },
    });
    await midnight(page, "__flakyReads", "");
    await page.locator('[aria-label="이전 날"]').click();
    await page.clock.runFor(2000);
    await page.evaluate(() => (window.__flakyReads = []));
    await page.clock.runFor(5000);
    await page.locator('[aria-label="다음 날"]').click();
    await page.clock.runFor(10_000);
    const f = await fs(page);
    assert.match(f[D15] ?? "", /원래/, J({ D14: f[D14], D15: f[D15] }));
    await context.close();
  });

  await scenario("QA9-01d[next-day] ◀ 상태에서 읽기가 돌아오면 어제를 보는 동안에도 정리된다(재시작을 기다리지 않음)", async () => {
    const { page, context } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("next-day"), [D14]: "- [ ] 원래\n", [D15]: "- [ ] 미리\n" },
    });
    await midnight(page, "__flakyReads");
    await page.locator('[aria-label="이전 날"]').click();
    await page.clock.runFor(2000);
    await page.evaluate(() => (window.__flakyReads = []));
    await page.clock.runFor(10_000);
    const f = await fs(page);
    assert.match(f[D15] ?? "", /원래/, J(f));
    // 보고 있던 어제 목록에서 옮겼으므로 어제 화면에도 남지 않는다
    assert.deepEqual(await texts(page, "today"), []);
    await context.close();
  });

  await scenario("QA9-01e[next-day] 새 날 파일이 UTF-8이 아님 → 다른 편집기로 고침 → 오늘을 보고 있으면 정리된다", async () => {
    const { page, context } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("next-day"), [D14]: "- [ ] 원래\n", [D15]: "- [ ] 미리\n" },
    });
    await midnight(page, "__badReads");
    await page.evaluate((p) => {
      window.__badReads = [];
      window.__setFile(p, "- [ ] 미리\n- [ ] 고침\n");
    }, D15);
    await page.clock.runFor(20_000);
    const f = await fs(page);
    assert.match(f[D15] ?? "", /쓰다만/, J(f));
    assert.match(f[D15] ?? "", /원래/);
    assert.match(f[D15] ?? "", /고침/);
    await context.close();
  });

  await scenario("QA9-01f[keep] 새 날 못 읽음: 글은 어제에 남고 '읽지 못한 파일' 안내. 종료해도 남고 quit_ready는 한 번", async () => {
    const { page, context, errors } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("keep"), [D14]: "- [ ] 원래\n", [D15]: "- [ ] 미리\n" },
    });
    await midnight(page, "__badReads");
    const foot = await footText(page);
    await page.evaluate(() => window.__emit("quit-requested", null));
    await page.clock.runFor(3000);
    assert.equal((await fs(page))[D14], "- [ ] 원래\n- [ ] 쓰다만\n");
    assert.match(foot, /읽지 못한 파일/);
    assert.equal(await dateLabel(page), "10월 15일 (목)");
    assert.equal((await calls(page, "quit_ready")).length, 1);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("QA9-01g 자정에 새 날 읽기가 느림(15초): 확인하는 동안 이어 적은 글도 남는다", async () => {
    const { page, context, errors } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("next-day"), [D14]: "- [ ] 원래\n", [D15]: "- [ ] 미리\n" },
    });
    await addInput(page).click();
    await page.keyboard.type("앞");
    await page.evaluate(() => (window.__readDelay = 15_000));
    await page.clock.runFor(31_000);
    await page.keyboard.type("뒤");
    await page.clock.runFor(40_000);
    await page.evaluate(() => (window.__readDelay = 0));
    await page.clock.runFor(20_000);
    const input = await addInput(page).inputValue().catch(() => null);
    const hits = await where(page, "앞");
    assert.ok(input === "앞뒤" || hits.length === 1, J({ input, hits, f: await fs(page) }));
    if (input !== "앞뒤") assert.match((await fs(page))[hits[0]], /앞뒤/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("QA9-01h 자정 + 새 날 못 읽음: 언젠가 입력칸 글은 그대로 입력칸에 남는다", async () => {
    const { page, context } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("next-day"), [D14]: "- [ ] 원래\n", "someday.md": "- [ ] s\n" },
    });
    await addInput(page, "someday").click();
    await page.keyboard.type("언젠글");
    await page.evaluate((p) => (window.__badReads = [p]), D15);
    await page.clock.runFor(60_000);
    assert.equal(await addInput(page, "someday").inputValue(), "언젠글");
    await context.close();
  });

  await scenario("QA9-01i 새 날을 이틀 넘게 못 읽다가 고쳐지면 밀린 정리가 한 번에 된다", async () => {
    const D16 = "daily/2026-10-16.md";
    const D17 = "daily/2026-10-17.md";
    const { page, context } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("next-day"), [D14]: "- [ ] 원래\n" },
    });
    await addInput(page).click();
    await page.keyboard.type("쓰다만");
    await page.evaluate(([a, b, c]) => (window.__flakyReads = [a, b, c]), [D15, D16, D17]);
    await page.clock.runFor(60_000);
    // 3초 확인을 이틀 내내 돌리면 수 분이 걸린다. 자정마다 건너뛰고 그 뒤 1분만 돌린다
    for (let day = 0; day < 2; day++) {
      await page.clock.fastForward(86_400_000 - 60_000);
      await page.clock.runFor(60_000);
    }
    assert.equal(await dateLabel(page), "10월 17일 (토)", "전제: 이틀이 지났다");
    await page.evaluate(() => (window.__flakyReads = []));
    await page.clock.runFor(10_000);
    const f = await fs(page);
    assert.match(f[D17] ?? "", /원래/, J(f));
    assert.match(f[D17] ?? "", /쓰다만/, J(f));
    await context.close();
  });

  await scenario("D4 오늘 목록이 막힌(읽지 못한 파일) 채 입력칸에 글이 남아 있으면, 종료해도 잃지 않고 다시 켜면 오늘 입력칸에 돌아온다", async () => {
    const { page, context, errors } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n", "someday.md": "- [ ] s\n" } });
    await addInput(page).click();
    await page.keyboard.type("쓰다만");
    await page.evaluate((p) => {
      window.__badReads = [p];
      window.__emit("file-changed", { path: p, source: "cli" });
    }, TODAY);
    await page.clock.runFor(500);
    assert.equal(await addInput(page).count(), 0, "전제: 오늘 목록이 막혔다");
    await page.evaluate(() => window.__emit("quit-requested", null));
    await page.clock.runFor(3000);
    assert.equal((await calls(page, "quit_ready")).length, 1);
    assert.equal((await fs(page))[TODAY], "- [ ] a\n");
    await reload(page);
    assert.equal(await addInput(page).inputValue(), "쓰다만");
    assert.deepEqual(errors, []);
    await context.close();
  });

  // ── QA9-02: 폴더를 바꿔 창이 새로고침돼도 입력칸 글은 남는다 ──
  for (const [copied, reason] of [
    [true, "copied"],
    [false, "kept"],
  ]) {
    await scenario(`QA9-02[${reason}] 입력칸에 쓰다 만 글을 두고 폴더 변경: 새로고침돼도 글이 할 일로 남는다`, async () => {
      const { page, context, errors } = await openApp(browser, { files: { [TODAY]: "- [ ] 원래\n" } });
      await addInput(page).click();
      await page.keyboard.type("쓰다만");
      await addInput(page, "someday").click();
      await page.keyboard.type("언젠글");
      await page.locator('[aria-label="설정"]').click();
      await page.clock.runFor(50);
      await prepareSwitch(page, { copied, reason, newFiles: copied ? null : { "daily/2026-10-10.md": "- [ ] 거기\n" } });
      let reloaded = false;
      page.on("load", () => (reloaded = true));
      await changeFolder(page);
      const f = await fs(page);
      assert.ok(reloaded, "전제: 창이 새로고침됨");
      assert.match(f[TODAY] ?? "", /- \[ \] 쓰다만/, J(f));
      assert.match(f["someday.md"] ?? "", /- \[ \] 언젠글/, J(f));
      assert.ok((await texts(page, "today")).includes("쓰다만"));
      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  await scenario("QA9-02b '기본 폴더 쓰기'(폴더를 열 수 없을 때)로 바꿔도 입력칸 글이 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 원래\n" } });
    await page.evaluate(() => window.__setRootAvailable(false));
    await addInput(page).click();
    await page.keyboard.type("쓰다만");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(100);
    await page.locator('[data-action="default-folder"]').click();
    await page.clock.runFor(3000).catch(() => {});
    await page.waitForSelector(".foot");
    await page.clock.runFor(3000);
    assert.deepEqual(await where(page, "쓰다만"), [TODAY]);
    await context.close();
  });

  await scenario("QA9-02c 모아보기 창도 폴더가 바뀌어 새로고침될 때 입력칸 글을 할 일로 남긴다", async () => {
    const { page, context, errors } = await openApp(browser, {
      hash: "#overview",
      viewport: { width: 1180, height: 760 },
      files: { [TODAY]: "- [ ] 원래\n" },
    });
    await addInput(page, "someday").click();
    await page.keyboard.type("모아본글");
    await page.evaluate(() => window.__emit("data-root-changed", { copied: true, reason: "copied" }));
    await page.clock.runFor(3000).catch(() => {});
    await page.waitForSelector(".foot");
    await page.clock.runFor(1000);
    assert.match((await fs(page))["someday.md"] ?? "", /- \[ \] 모아본글/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // ── QA9-03: 설정 파일이 없는 폴더로 바꾸면 이 창의 설정을 그대로 쓴다 ──
  await scenario("QA9-03 설정 파일이 없는 '할 일이 있는 폴더'(kept)로 바꾸면 이 창의 설정(AI 허용 끔·투명도 40·핀 끔·다음 날로)을 그대로 쓴다", async () => {
    const mine = { opacity: 40, alwaysOnTop: false, sortChecked: false, allowExternalAdd: false, carryOver: "next-day", lastRolloverDate: "2026-10-14", splitRatio: 0.5 };
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 원래\n", "settings.json": J(mine) } });
    await page.locator('[aria-label="설정"]').click();
    await prepareSwitch(page, { copied: false, reason: "kept", newFiles: { "daily/2026-10-10.md": "- [ ] 거기\n" } });
    await changeFolder(page);
    const s = await settingsOf(page);
    assert.deepEqual(
      { allowExternalAdd: s?.allowExternalAdd, opacity: s?.opacity, alwaysOnTop: s?.alwaysOnTop, carryOver: s?.carryOver, sortChecked: s?.sortChecked },
      { allowExternalAdd: false, opacity: 40, alwaysOnTop: false, carryOver: "next-day", sortChecked: false },
      J(s),
    );
    assert.equal(await range(page).inputValue(), "40");
    await context.close();
  });

  await scenario("QA9-03b [대조] 설정 파일이 있는 kept 폴더면 그 폴더 설정을 따른다(N6 규칙)", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 원래\n", "settings.json": J({ opacity: 40, allowExternalAdd: false }) } });
    await page.locator('[aria-label="설정"]').click();
    await prepareSwitch(page, {
      copied: false,
      reason: "kept",
      newFiles: { "daily/2026-10-10.md": "- [ ] 거기\n", "settings.json": J({ opacity: 70, allowExternalAdd: true }) },
    });
    await changeFolder(page);
    const s = await settingsOf(page);
    assert.equal(s.opacity, 70);
    assert.equal(s.allowExternalAdd, true);
    await context.close();
  });

  // ── QA9-04: 설정을 다시 읽으면 창(투명도·항상 위)에도 맞추고, 못 읽는 동안 바꾼 값은 지킨다 ──
  await scenario("QA9-04 켤 때 저장 폴더가 안 붙어 있다가(iCloud 늦게 붙음) 돌아오면: 슬라이더·핀 표시와 실제 창이 같다", async () => {
    const { page, context, errors } = await openApp(browser, {
      rootUnavailable: true,
      files: { [TODAY]: "- [ ] 원래\n", "settings.json": J({ opacity: 40, alwaysOnTop: false }) },
    });
    await page.clock.runFor(1000);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(4000);
    const detail = J({ op: await calls(page, "set_window_opacity"), pin: await calls(page, "plugin:window|set_always_on_top") });
    assert.equal(await range(page).inputValue(), "40");
    assert.ok(Math.abs((await lastAlpha(page)) - 0.52) < 0.001, detail);
    assert.equal(await lastPin(page), false, detail);
    // 핀을 한 번 누르면 다시 켜진다(두 번 누를 필요 없음)
    await page.locator('[aria-label="항상 위에 고정"]').click();
    assert.equal(await lastPin(page), true);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("QA9-04b 설정 파일을 못 읽는 동안 투명도를 30으로 내림 → 파일이 고쳐짐(투명도 70): 바꾼 30이 남고 창도 30이다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [TODAY]: "- [ ] 원래\n", "settings.json": "BAD" },
      globals: { __badReads: ["settings.json"] },
    });
    await page.clock.runFor(500);
    await range(page).fill("30");
    await page.clock.runFor(1500);
    const a30 = await lastAlpha(page);
    await page.evaluate(() => {
      window.__badReads = [];
      window.__setFile("settings.json", JSON.stringify({ opacity: 70, allowExternalAdd: false }));
    });
    await page.clock.runFor(4000);
    const s = await settingsOf(page);
    assert.equal(await range(page).inputValue(), "30");
    assert.equal(await lastAlpha(page), a30);
    assert.equal(s.opacity, 30, J(s));
    assert.equal(s.allowExternalAdd, false, J(s));
    await context.close();
  });

  await scenario("QA9-04c 폴더를 열 수 없는 동안 설정 3개 변경 → '폴더 다시 고르기'로 설정 있는 kept 폴더: 바꾼 3개만 얹고 lastRolloverDate는 새 폴더 것", async () => {
    const { page, context } = await openApp(browser, {
      files: {
        [TODAY]: "- [ ] 원래\n",
        "settings.json": J({ opacity: 100, sortChecked: true, allowExternalAdd: true, carryOver: "keep", lastRolloverDate: "2026-10-14" }),
      },
    });
    await page.clock.runFor(500);
    await page.evaluate(() => window.__setRootAvailable(false));
    await range(page).fill("20");
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(50);
    await page.locator('[data-setting="sortChecked"]').click();
    await page.locator('[role="radio"]').nth(2).click();
    await page.clock.runFor(1500);
    await page.locator('[data-action="close"]').click();
    await page.evaluate(() => {
      window.__setRootAvailable(true);
      window.__setRootEmits = true;
      window.__setRootCopied = false;
      window.__setRootReason = "kept";
      window.__pickResult = "/Users/me/Dropbox/todo";
      for (const k of Object.keys(window.__mockFs)) window.__setFile(k, null);
      window.__setFile(
        "settings.json",
        JSON.stringify({ opacity: 90, sortChecked: true, allowExternalAdd: true, carryOver: "next-day", lastRolloverDate: "2026-10-12", alwaysOnTop: false }),
      );
      window.__setFile("daily/2026-10-13.md", "- [ ] 밀린일\n");
    });
    await page.locator('[data-action="repick-folder"]').click();
    await page.clock.runFor(3000).catch(() => {});
    await page.waitForSelector(".foot");
    await page.clock.runFor(5000);
    const s = await settingsOf(page);
    const f = await fs(page);
    const detail = J({ s, f });
    assert.equal(s.opacity, 20, detail);
    assert.equal(s.sortChecked, false, detail);
    assert.equal(s.carryOver, "someday", detail);
    assert.equal(s.alwaysOnTop, false, detail);
    assert.equal(s.lastRolloverDate, "2026-10-14", detail);
    assert.match(f["someday.md"] ?? "", /밀린일/, detail);
    await context.close();
  });

  // ── QA9-05·AI9: AI 도구에 연결 ──
  await scenario("QA9-05 Claude 데스크톱 설치가 느릴 때(5초) 설정을 닫았다 다시 열어도 버튼은 꺼져 있고 설치 호출은 한 번", async () => {
    const { page, context, errors } = await openApp(browser, { globals: { __installDelay: 5000 } });
    await openSettings(page);
    await btn(page, "claude-desktop").click();
    await page.clock.runFor(200);
    await page.locator('[data-action="close"]').click();
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(50);
    assert.equal(await btn(page, "claude-desktop").isDisabled(), true);
    await btn(page, "claude-desktop").click({ force: true });
    await page.clock.runFor(6000);
    assert.equal((await calls(page, "install_claude_desktop")).length, 1);
    assert.equal(await btn(page, "claude-desktop").isDisabled(), false, "설치가 끝나면 다시 누를 수 있다");
    assert.deepEqual(errors, []);
    await context.close();
  });

  // 빈 문자열 이유는 모의 백엔드가 실패로 다루지 못하고, 객체 이유는 Rust가 보내지 않는다(String만) — QA9 판정대로 뺐다
  await scenario("AI9-2 설치 실패 이유가 2000자여도 안내가 보이고 260px 창이 가로로 넘치지 않는다", async () => {
    const { page, context, errors } = await openApp(browser, { globals: { __installFail: "가".repeat(2000) }, viewport: { width: 260, height: 300 } });
    await openSettings(page);
    await btn(page, "claude-desktop").click();
    await page.clock.runFor(10);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(await label(page, "claude-desktop"), "열지 못함");
    assert.match(await connectText(page), /가{100}/);
    assert.ok(overflow <= 0, `가로 넘침 ${overflow}px`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("AI9-3 'AI·명령어로 추가 허용'을 끄고 켜면 연결 칸 안내가 바로 따라 바뀐다", async () => {
    const { page, context } = await openApp(browser);
    await openSettings(page);
    assert.doesNotMatch(await connectText(page), /꺼져 있어요/);
    await page.locator('[data-setting="allowExternalAdd"]').click();
    await page.clock.runFor(10);
    assert.match(await connectText(page), /꺼져 있어요/);
    await page.locator('[data-setting="allowExternalAdd"]').click();
    await page.clock.runFor(10);
    assert.doesNotMatch(await connectText(page), /꺼져 있어요/);
    await context.close();
  });

  await scenario("AI9-4 복사 실패로 보인 명령은 데스크톱 설치 성공 안내로 바뀌고, 다음 복사가 성공하면 안내가 지워진다", async () => {
    const { page, context } = await openApp(browser);
    await openSettings(page, { clipboardFails: true });
    await btn(page, "claude-code").click();
    await page.clock.runFor(10);
    assert.equal(await page.locator(".connect .command").count(), 1);
    await btn(page, "claude-desktop").click();
    await page.clock.runFor(10);
    assert.equal(await page.locator(".connect .command").count(), 0);
    assert.match(await connectText(page), /설치를 확인해 주세요/);
    await page.evaluate(() => (navigator.clipboard.writeText = async (t) => (window.__copied = t)));
    await btn(page, "codex").click();
    await page.clock.runFor(10);
    assert.doesNotMatch(await connectText(page), /설치를 확인해 주세요/);
    assert.equal(await label(page, "codex"), "복사됨 ✓");
    await context.close();
  });

  await scenario("AI9-5 설치 중에 Claude Code 복사: 복사는 되고, 설치가 실패하면 그 이유와 '열지 못함'이 보인다", async () => {
    const { page, context } = await openApp(browser, { globals: { __installDelay: 1000, __installFail: "열지 못했어요(모의)" } });
    await openSettings(page);
    await btn(page, "claude-desktop").click();
    await page.clock.runFor(100);
    await btn(page, "claude-code").click();
    await page.clock.runFor(10);
    assert.match((await page.evaluate(() => window.__copied)) ?? "", /^claude mcp add/);
    await page.clock.runFor(1000);
    assert.match(await connectText(page), /열지 못했어요\(모의\)/);
    assert.equal(await label(page, "claude-desktop"), "열지 못함");
    await context.close();
  });

  await scenario("AI9-6 연결 정보 실패 → 설정을 다시 열 때 성공하면 버튼이 켜지고 실패 안내가 사라진다", async () => {
    const { page, context } = await openApp(browser, { globals: { __aiInfoFail: "모의 실패" } });
    await openSettings(page);
    assert.match(await connectText(page), /연결 정보를 읽지 못했어요/);
    await page.evaluate(() => (window.__aiInfoFail = undefined));
    await page.locator('[data-action="close"]').click();
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(10);
    assert.doesNotMatch(await connectText(page), /읽지 못했어요/);
    assert.equal(await btn(page, "codex").isDisabled(), false);
    await context.close();
  });

  await scenario("AI9-7 1000자 경로 + 복사 실패: 명령 글이 260px 창에서 넘치지 않고 따옴표로 바르게 감싸진다", async () => {
    const long = "/Volumes/" + "아주긴폴더 이름'$`!".repeat(50) + "/Aru.app/Contents/MacOS/aru";
    const { page, context } = await openApp(browser, { globals: { __aruCommand: long }, viewport: { width: 260, height: 300 } });
    await openSettings(page, { clipboardFails: true });
    await btn(page, "codex").click();
    await page.clock.runFor(10);
    const cmd = (await page.locator(".connect .command").textContent()).trim();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(cmd.startsWith("codex mcp add aru -- '/Volumes/"), cmd.slice(0, 80));
    assert.ok(cmd.endsWith("/aru' mcp"), cmd.slice(-40));
    assert.ok(overflow <= 0, `가로 넘침 ${overflow}px`);
    await context.close();
  });

  await scenario("AI9-8 키보드만으로 연결 버튼에 닿아 Enter로 복사한다(Chromium Tab, WebKit ⌥Tab)", async () => {
    const { page, context } = await openApp(browser);
    await openSettings(page);
    const key = process.env.E2E_BROWSER === "webkit" ? "Alt+Tab" : "Tab";
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) {
      await page.keyboard.press(key);
      reached = await page.evaluate(() => document.activeElement?.getAttribute("data-action") === "connect-claude-code");
    }
    assert.ok(reached, "연결 버튼에 키보드로 닿지 못함");
    await page.keyboard.press("Enter");
    await page.clock.runFor(10);
    assert.match((await page.evaluate(() => window.__copied)) ?? "", /^claude mcp add/);
    await context.close();
  });

  await scenario("AI9-9 '열지 못함'이 보이는 1.5초 안에 다시 눌러 성공하면 버튼은 원래 이름이고 성공 안내만 남는다", async () => {
    const { page, context } = await openApp(browser, { globals: { __installFail: "실패(모의)" } });
    await openSettings(page);
    await btn(page, "claude-desktop").click();
    await page.clock.runFor(300);
    await page.evaluate(() => (window.__installFail = undefined));
    await btn(page, "claude-desktop").click();
    await page.clock.runFor(10);
    const t = await connectText(page);
    assert.match(t, /설치를 확인해 주세요/);
    assert.doesNotMatch(t, /실패\(모의\)/);
    assert.equal(await label(page, "claude-desktop"), "Claude 데스크톱");
    await context.close();
  });

  // ── show-date 경계 ──
  const bad = ["1969-12-31", "10000-01-01", "2026-2-3", "２０２６-10-15", "2026-10-15T00:00", " 2026-10-15", "2026-10-15\n", "", null, 20261015, "2026-00-10", "2026-10-00", "2100-02-29"];
  await scenario(`SD9-1 show-date 이상한 값 ${bad.length}가지는 모두 무시하고 오류 없이 창만 보인다`, async () => {
    const { page, context, errors } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    const seen = [];
    for (const v of bad) {
      await page.evaluate((d) => window.__emit("show-date", d), v);
      await page.clock.runFor(100);
      seen.push([v, await dateLabel(page)]);
    }
    assert.ok(seen.every(([, l]) => l === "10월 14일 (수)"), J(seen));
    assert.ok(!Object.keys(await fs(page)).some((k) => k !== TODAY && k.startsWith("daily/")));
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("SD9-2 show-date 1970-01-01·9999-12-31·2028-02-29는 받고, 1970-01-01에서 ◀은 꺼져 있다", async () => {
    const { page, context, errors } = await openApp(browser);
    const got = [];
    for (const d of ["1970-01-01", "9999-12-31", "2028-02-29"]) {
      await page.evaluate((x) => window.__emit("show-date", x), d);
      await page.clock.runFor(300);
      got.push(await dateLabel(page));
    }
    await page.evaluate(() => window.__emit("show-date", "1970-01-01"));
    await page.clock.runFor(300);
    assert.equal(await page.locator('[aria-label="이전 날"]').isDisabled(), true);
    assert.ok(got[0].startsWith("1월 1일") && got[1].startsWith("12월 31일") && got[2].startsWith("2월 29일"), J(got));
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("SD9-3 입력칸에 쓰는 중 show-date로 다른 날을 보이면 글은 떠나는 날에 들어간다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    await addInput(page).click();
    await page.keyboard.type("쓰다만");
    await page.evaluate(() => window.__emit("show-date", "2026-10-20"));
    await page.clock.runFor(2000);
    assert.match((await fs(page))[TODAY], /쓰다만/);
    assert.equal(await dateLabel(page), "10월 20일 (화)");
    await context.close();
  });

  await scenario("SD9-4 잘못된 show-date(2026-02-31)는 입력칸 글을 건드리지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    await addInput(page).click();
    await page.keyboard.type("쓰다만");
    await page.evaluate(() => window.__emit("show-date", "2026-02-31"));
    await page.clock.runFor(2000);
    assert.equal(await addInput(page).inputValue(), "쓰다만");
    await context.close();
  });

  // ── 종료 ──
  await scenario("QW9-1 종료 대기 안내 뒤 새로고침된 창에 quit-requested가 와도 quit_ready를 부른다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    await page.evaluate(() => window.__emit("quit-waiting", null));
    await page.clock.runFor(10);
    assert.match(await footText(page), /끝나면 종료해요/);
    await reload(page);
    await page.evaluate(() => window.__emit("quit-requested", null));
    await page.clock.runFor(2000);
    assert.equal((await calls(page, "quit_ready")).length, 1);
    await context.close();
  });

  await scenario("QW9-2 종료 대기 안내는 '저장 폴더를 열 수 없어요'보다 앞에 보이고, 60초 뒤엔 원래 경고로 돌아온다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    await page.evaluate(() => window.__setRootAvailable(false));
    await itemText(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("1");
    await page.clock.runFor(1500);
    await page.evaluate(() => window.__emit("quit-waiting", null));
    await page.clock.runFor(10);
    const during = await footText(page);
    await page.clock.runFor(61_000);
    assert.match(during, /끝나면 종료해요/);
    assert.match(await footText(page), /저장 폴더를 열 수 없어요/);
    await context.close();
  });

  await scenario("D7 종료 대기(quit-waiting)가 오면 숨겨 둔 작은 창을 띄운다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    assert.equal((await calls(page, "plugin:window|show")).length, 0);
    await page.evaluate(() => window.__emit("quit-waiting", null));
    await page.clock.runFor(10);
    assert.equal((await calls(page, "plugin:window|show")).length, 1);
    await context.close();
  });

  await scenario("D5 종료가 폴더 옮기기를 기다리는 사이 폴더가 바뀌어 새로고침되면, quit-requested를 못 받아도 새 창이 저장 후 quit_ready를 부른다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    await page.evaluate(() => window.__emit("quit-waiting", null));
    await page.clock.runFor(10);
    // Rust는 이 직후 quit-requested를 보내지만 새 페이지는 아직 듣지 않는다(보내지 않는 것으로 흉내)
    await page.evaluate(() => window.__emit("data-root-changed", { copied: true, reason: "copied" }));
    await page.clock.runFor(3000).catch(() => {});
    await page.waitForSelector(".foot");
    await page.clock.runFor(1000);
    assert.equal((await calls(page, "quit_ready")).length, 1);
    await context.close();
  });

  await scenario("D5b 그냥 켠 창은 quit_ready를 부르지 않는다(폴더를 바꿔 새로고침된 창만)", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    await page.clock.runFor(1000);
    await reload(page);
    await page.clock.runFor(1000);
    assert.equal((await calls(page, "quit_ready")).length, 0);
    await context.close();
  });

  await scenario("QT9-1 종료: 오늘·언젠가 입력칸 글이 모두 저장되고 quit_ready가 한 번", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n", "someday.md": "- [ ] s\n" } });
    await addInput(page).click();
    await page.keyboard.type("오늘글");
    await addInput(page, "someday").click();
    await page.keyboard.type("언젠글");
    await page.evaluate(() => window.__emit("quit-requested", null));
    await page.clock.runFor(2000);
    const f = await fs(page);
    assert.match(f[TODAY], /오늘글/);
    assert.match(f["someday.md"], /언젠글/);
    assert.equal((await calls(page, "quit_ready")).length, 1);
    await context.close();
  });

  await scenario("QT9-2 종료 때 쓰기가 응답하지 않아도 10초 안에(Rust 11초 전에) quit_ready를 부른다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    await page.evaluate(() => (window.__hangWrites = true));
    await addInput(page).click();
    await page.keyboard.type("x");
    await page.evaluate(() => window.__emit("quit-requested", null));
    await page.clock.runFor(10_500);
    assert.equal((await calls(page, "quit_ready")).length, 1);
    await context.close();
  });

  await scenario("QT9-3 설정 화면을 연 채(입력칸은 숨음) 종료해도 숨은 입력칸 글이 저장된다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    await addInput(page).click();
    await page.keyboard.type("숨은글");
    await page.locator('[aria-label="설정"]').click();
    await page.evaluate(() => window.__emit("quit-requested", null));
    await page.clock.runFor(2000);
    assert.match((await fs(page))[TODAY], /숨은글/);
    await context.close();
  });

  await scenario("QT9-4 자정 확인(새 날 읽기 5초) 중에 종료해도 입력칸 글을 잃지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("next-day"), [TODAY]: "- [ ] a\n" },
    });
    await addInput(page).click();
    await page.keyboard.type("쓰다만");
    await page.evaluate(() => (window.__readDelay = 5000));
    await page.clock.runFor(30_500);
    await page.evaluate(() => window.__emit("quit-requested", null));
    await page.clock.runFor(12_000);
    assert.ok((await where(page, "쓰다만")).length >= 1, J(await fs(page)));
    await context.close();
  });

  // ── QA9-06: 같은 파일 저장이 계속 실패하는 동안은 "저장 실패"가 남는다 ──
  await scenario("ST9-1 설정 저장만 계속 실패하는 동안 할 일 저장이 성공해도 '저장 실패'가 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n", "settings.json": J({ opacity: 100 }) } });
    await page.evaluate(() => {
      const orig = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
        if ((cmd === "write_text" || cmd === "write_text_if") && args.path === "settings.json") throw "디스크 오류(설정 모의)";
        return orig(cmd, args);
      };
    });
    await page.locator('[aria-label="항상 위에 고정"]').click();
    await page.clock.runFor(500);
    const s1 = await status(page);
    await itemText(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("1");
    await page.clock.runFor(1500);
    const s2 = await status(page);
    await page.clock.runFor(6000);
    assert.equal((await fs(page))[TODAY], "- [ ] a1\n");
    assert.deepEqual([s1, s2, await status(page)], [FAILED, FAILED, FAILED]);
    await context.close();
  });

  await scenario("QA9-06 실패한 저장의 재시도를 기다리는 중에 같은 파일을 또 고쳐도 '저장 실패'가 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    await page.evaluate((p) => (window.__failPaths = [p]), TODAY);
    await itemText(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("1");
    await page.clock.runFor(1500);
    const s1 = await status(page);
    await page.keyboard.type("2");
    await page.clock.runFor(300);
    const s2 = await status(page);
    await page.clock.runFor(2000);
    assert.deepEqual([s1, s2, await status(page)], [FAILED, FAILED, FAILED]);
    await context.close();
  });

  await scenario("QA9-06b 같은 파일 저장이 계속 실패하는 동안 0.5초마다 이어 적어도 내내 '저장 실패'이고, 풀리면 '저장됨'", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    await page.evaluate((p) => (window.__failPaths = [p]), TODAY);
    await itemText(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("1");
    await page.clock.runFor(1500);
    const seen = [];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.type("x");
      await page.clock.runFor(500);
      seen.push(await status(page));
    }
    assert.ok(seen.every((x) => x === FAILED), J([...new Set(seen)]));
    await page.evaluate(() => (window.__failPaths = []));
    await page.clock.runFor(6000);
    assert.match(await status(page), /저장됨/);
    assert.equal((await fs(page))[TODAY], `- [ ] a1${"x".repeat(20)}\n`);
    await context.close();
  });
}
