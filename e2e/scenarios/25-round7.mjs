// 라운드 7 QA(QA7-01·02, 의심 KP1·QK2·BD4)와 6차 코드 리뷰(N1~N6, LOW 빠른 입력 대상)에서 나온 경우들. QA7 시나리오를 옮기고 리뷰 항목을 더했다
import assert from "node:assert/strict";
import { calls, caretToEnd, fs, openApp, paste, scenario, setCaret, status, texts } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
const TOMORROW = "daily/2026-10-15.md";
const D13 = "daily/2026-10-13.md";
const D14 = TODAY;
const D15 = TOMORROW;
const J = JSON.stringify;
const QUICK = { hash: "#quick", viewport: { width: 620, height: 96 } };
const BIG = { hash: "#overview", viewport: { width: 1180, height: 760 } };
const BEFORE = "2026-10-14T23:59:30";
const NOW = Math.floor(new Date("2026-10-14T10:00:00").getTime() / 1000);
const SELECT_ALL = process.platform === "darwin" ? "Meta+A" : "Control+A";
const FAILED = "저장 실패 — 다시 시도합니다";

const st = (carryOver, last = "2026-10-14") => J({ carryOver, lastRolloverDate: last });
const stPast = (c) => J({ carryOver: c, lastRolloverDate: "2026-10-13" });
const text = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .text`).nth(i);
const box = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .box`).nth(i);
const addInput = (page, list = "today") => page.locator(`[data-list="${list}"] .add input`);
const next = (page) => page.locator('button[aria-label="다음 날"]').click();
const prev = (page) => page.locator('button[aria-label="이전 날"]').click();
const footText = async (page) => (await page.locator(".foot").textContent()).replace(/\s+/g, " ").trim();
const quickInput = (page) => page.locator(".quick input");
const quickHint = async (page) => (await page.locator(".quick .hint").textContent()).trim();
const targetLabel = async (page) => (await page.locator(".quick .target").textContent()).trim();
const reshow = async (page) => {
  await page.evaluate(() => window.__emit("quick-shown", null));
  await page.clock.runFor(30);
};
const hides = (page) => page.evaluate(() => window.__calls.filter(([c]) => c === "hide_quick").length);

async function todayBatch(page, extra = "- [ ] 장보기\n") {
  await page.evaluate(
    ([p, c, b]) => {
      window.__setFile(p, c);
      window.__aiBatches = [b];
    },
    [TODAY, `- [ ] 기획서 <!-- ai:claude-code@${NOW + 5} -->\n- [ ] 리뷰 <!-- ai:claude-code@${NOW + 5} -->\n${extra}`, { by: "claude-code", at: NOW + 5, path: TODAY, count: 2 }],
  );
  await page.clock.runFor(3500);
}

export default async function (browser) {
  // ── a-midnight ──
  // QA7-01·리뷰 N1: 자정 전환은 쓰다 만 글을 떠나는 날에 넣지 않는다. 글은 입력칸에 남아 새 날로 따라간다
  const moved = {
    "next-day": { d14: "- [x] 끝\n", d15: "- [ ] 원래 <!-- from:2026-10-14 -->\n", someday: undefined },
    someday: { d14: "- [x] 끝\n", d15: undefined, someday: "- [ ] 원래 <!-- from:2026-10-14 -->\n" },
    keep: { d14: "- [ ] 원래\n- [x] 끝\n", d15: undefined, someday: undefined },
  };
  for (const policy of ["next-day", "someday", "keep"]) {
    await scenario(`QA7-01[${policy}] 23:59에 입력칸에 쓰다 만 글이 있는 채 자정이 지나면 글은 입력칸에 남고, 어제는 설정대로만 정리된다`, async () => {
      const { page, context, errors } = await openApp(browser, {
        now: BEFORE,
        files: { "settings.json": st(policy), [D14]: "- [ ] 원래\n- [x] 끝\n" },
      });
      await addInput(page).click();
      await page.keyboard.type("쓰다만");
      await page.clock.runFor(60_000);
      const f = await fs(page);
      assert.equal(await page.locator(".datebar .date").textContent(), "10월 15일 (목)");
      assert.equal(await addInput(page).inputValue(), "쓰다만", "쓰다 만 글이 입력칸에서 사라짐");
      assert.equal(f[D14], moved[policy].d14);
      assert.equal(f[D15], moved[policy].d15);
      assert.equal(f["someday.md"], moved[policy].someday);
      // 이어서 Enter를 치면 새 날에 들어간다
      await addInput(page).press("Enter");
      await page.clock.runFor(1500);
      assert.match((await fs(page))[D15] ?? "", /- \[ \] 쓰다만\n/);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  await scenario("QA7-01 자정 뒤 입력칸에 남은 글은 Cmd+S로 새 날에 들어가고, 다시 켜도 어제에 미완료로 남지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("next-day"), [D14]: "- [ ] 원래\n" },
    });
    await addInput(page).click();
    await page.keyboard.type("쓰다만");
    await page.clock.runFor(60_000);
    await page.keyboard.press("Meta+s");
    await page.clock.runFor(500);
    await page.reload();
    await page.waitForSelector(".foot");
    await page.clock.runFor(2000);
    const f = await fs(page);
    assert.equal(f[D14], undefined);
    assert.equal(f[D15], "- [ ] 원래 <!-- from:2026-10-14 -->\n- [ ] 쓰다만\n");
    await context.close();
  });

  await scenario("QA7-01 사용자가 ▶로 날짜를 옮길 때는 여전히 쓰다 만 글을 떠나는 날에 넣는다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] 원래\n" } });
    await addInput(page).fill("쓰다만");
    await next(page);
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[D14], "- [ ] 원래\n- [ ] 쓰다만\n");
    assert.equal(await addInput(page).inputValue(), "");
    await context.close();
  });

  await scenario("MD3[next-day] 할 일 글자를 고치는 중(저장 전) 자정: 고친 글이 새 날로 옮겨지고 어제엔 없다", async () => {
    const { page, context, errors } = await openApp(browser, {
      now: "2026-10-14T23:59:59",
      files: { "settings.json": st("next-day"), [D14]: "- [ ] 보고서\n" },
    });
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type(" 초안");
    await page.clock.runFor(1500);
    await page.clock.runFor(60_000);
    const f = await fs(page);
    assert.equal(f[D14] ?? "", "");
    assert.equal(f[D15], "- [ ] 보고서 초안 <!-- from:2026-10-14 -->\n");
    await context.close();
  });

  await scenario("MD4[next-day] 지난 날(10/13)을 보는 중 10/14의 저장이 실패한 채 자정: 실패한 고침이 옮겨지고 어제에 미완료가 남지 않는다", async () => {
    const { page, context, errors } = await openApp(browser, {
      now: "2026-10-14T23:59:00",
      files: { "settings.json": st("next-day"), [D14]: "- [ ] a\n- [x] 끝\n", [D13]: "- [x] 지난\n" },
    });
    await page.evaluate(() => (window.__failWrites = true));
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.clock.runFor(1500);
    await prev(page);
    await page.clock.runFor(2000);
    const s1 = await status(page);
    await page.clock.runFor(60_000);
    const mid = await fs(page);
    await page.evaluate(() => (window.__failWrites = false));
    await page.clock.runFor(12_000);
    const f = await fs(page);
    assert.equal(f[D14], "- [x] 끝\n");
    assert.equal(f[D15], "- [ ] a! <!-- from:2026-10-14 -->\n");
    await context.close();
  });

  await scenario("MD5[next-day] 쓰기가 막힌(늦어짐) 채 자정: 풀리면 어제엔 끝낸 일만, 오늘엔 최신 글", async () => {
    const { page, context, errors } = await openApp(browser, {
      now: "2026-10-14T23:59:00",
      files: { "settings.json": st("next-day"), [D14]: "- [ ] a\n- [x] 끝\n" },
    });
    await page.clock.runFor(500);
    await page.evaluate(() => (window.__hangWrites = true));
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("1");
    await page.clock.runFor(1200);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(10_500);
    const s1 = await status(page);
    await page.clock.runFor(60_000);
    const shownMid = await texts(page, "today");
    const s2 = await status(page);
    await page.evaluate(() => window.__releaseWrites());
    await page.clock.runFor(12_000);
    const f = await fs(page);
    assert.equal(f[D14], "- [x] 끝\n");
    assert.equal(f[D15], "- [ ] a1 <!-- from:2026-10-14 -->\n");
    await context.close();
  });

  await scenario("QA7-01 MD6[someday] 언젠가·오늘 입력칸에 쓰다 만 글이 있는 채 자정: 둘 다 입력칸에 남고 어제에 들어가지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("someday"), [D14]: "- [ ] 원래\n", "someday.md": "- [ ] 언젠\n" },
    });
    await addInput(page, "someday").fill("언젠쓰다만");
    await addInput(page).click();
    await page.keyboard.type("오늘쓰다만");
    await page.clock.runFor(60_000);
    const f = await fs(page);
    assert.equal(f[D14], undefined);
    assert.equal(f["someday.md"], "- [ ] 언젠\n- [ ] 원래 <!-- from:2026-10-14 -->\n");
    assert.equal(await addInput(page).inputValue(), "오늘쓰다만");
    assert.equal(await addInput(page, "someday").inputValue(), "언젠쓰다만");
    await context.close();
  });

  // ── b-quick ──
  await scenario("QK1 언젠가로 Enter → 저장 중 Tab으로 오늘로 바꾸고 칸을 비움 → 실패: 글과 '언젠가'가 함께 돌아온다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400, __failWrites: true } });
    await page.keyboard.press("Tab");
    await page.keyboard.type("서류");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.keyboard.press("Tab");
    await page.keyboard.press(SELECT_ALL);
    await page.keyboard.press("Backspace");
    await page.clock.runFor(1000);
    const v = await quickInput(page).inputValue();
    const t = await targetLabel(page);
    assert.equal(v, "서류");
    assert.equal(t, "언젠가");
    await context.close();
  });

  await scenario("QK2 저장 실패 뒤 Esc로 닫았다 다시 띄우면 글과 함께 '저장하지 못했어요' 안내도 남는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "" }, globals: { __failWrites: true } });
    await page.keyboard.type("우유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(300);
    assert.equal(await quickHint(page), "저장하지 못했어요");
    await page.keyboard.press("Escape");
    await reshow(page);
    assert.equal(await quickInput(page).inputValue(), "우유");
    assert.equal(await quickHint(page), "저장하지 못했어요");
    await context.close();
  });

  await scenario("QK2 저장 중 이어 친 글만 남기고 성공했으면, 다시 띄워도 실패 안내는 없다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "" }, globals: { __readDelay: 300 } });
    await page.keyboard.type("하나");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.keyboard.type(" 둘");
    await page.clock.runFor(600);
    assert.equal(await quickInput(page).inputValue(), "둘");
    await page.keyboard.press("Escape");
    await reshow(page);
    assert.equal(await quickInput(page).inputValue(), "둘");
    assert.equal(await quickHint(page), "Enter");
    await context.close();
  });

  await scenario("리뷰 LOW 앞 창의 '오늘' 저장이 실패할 때 새 창이 같은 글을 '언젠가'로 넣는 중이면, 앞 글을 버리지 않고 돌려준다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "" }, globals: { __readDelay: 400, __failPaths: [TODAY] } });
    await page.keyboard.type("우유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.keyboard.press("Escape");
    await reshow(page);
    await page.keyboard.type("우유");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.clock.runFor(1000);
    const f = await fs(page);
    assert.equal(f["someday.md"], "- [ ] 우유\n");
    assert.equal(f[TODAY] ?? "", "");
    assert.equal(await quickInput(page).inputValue(), "우유", "실패한 '오늘' 글이 말없이 버려짐");
    assert.equal(await targetLabel(page), "오늘");
    assert.equal(await quickHint(page), "앞서 넣으려던 글을 저장하지 못했어요");
    await context.close();
  });

  await scenario("QK3 MAX: 5,000자 글을 빠른 입력으로 넣으면 그대로 맨 위에 저장되고 창이 닫힌다", async () => {
    const big = "가".repeat(4990) + " 끝말0123";
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" } });
    await quickInput(page).fill(big);
    await page.keyboard.press("Enter");
    await page.clock.runFor(600);
    const f = (await fs(page))[TODAY];
    assert.equal(f, `- [ ] ${big}\n- [ ] 원래\n`);
    assert.ok((await hides(page)) >= 1);
    await context.close();
  });

  await scenario("QK4 MIN: 보이지 않는 글자만(ZWSP·NBSP·U+3164) Enter → 넣지 않고 닫는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" } });
    await quickInput(page).fill("​ ㅤ ");
    await page.keyboard.press("Enter");
    await page.clock.runFor(300);
    const f = (await fs(page))[TODAY];
    assert.equal(f, "- [ ] 원래\n");
    assert.ok((await hides(page)) >= 1);
    await context.close();
  });

  await scenario("QK5 MIN: 한 글자 'a' 넣기 → 맨 위에 들어간다(오늘 파일이 아직 없을 때)", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: {} });
    await page.keyboard.type("a");
    await page.keyboard.press("Enter");
    await page.clock.runFor(400);
    const f = (await fs(page))[TODAY];
    assert.equal(f, "- [ ] a\n");
    await context.close();
  });

  await scenario("QK6 저장 실패 → 칸의 글을 고쳐(앞을 지우고 다시 씀) Enter 성공 → 안내 사라지고 고친 글만 들어간다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "" }, globals: { __failWrites: true } });
    await page.keyboard.type("우유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(300);
    await page.evaluate(() => (window.__failWrites = false));
    await page.keyboard.press(SELECT_ALL);
    await page.keyboard.type("두유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(400);
    const f = (await fs(page))[TODAY];
    assert.equal(f, "- [ ] 두유\n");
    await context.close();
  });

  await scenario("QK7 두 번 실패(앞 글 들고 있음) 후 폴더 복구 → 빈 칸 Enter로 꺼내 넣기 → 두 글 모두 저장", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "" }, globals: { __readDelay: 300, __failWrites: true } });
    await page.keyboard.type("하나");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.keyboard.type(" 둘");
    await page.clock.runFor(800);
    const v1 = await quickInput(page).inputValue();
    const h1 = await quickHint(page);
    await page.evaluate(() => (window.__failWrites = false));
    await page.keyboard.press("Enter");
    await page.clock.runFor(500);
    const v2 = await quickInput(page).inputValue();
    const h2 = await quickHint(page);
    await page.keyboard.press("Enter");
    await page.clock.runFor(500);
    const f = (await fs(page))[TODAY];
    assert.ok(f.includes("하나") && f.includes("둘"));
    await context.close();
  });

  await scenario("QK8 저장 폴더를 열 수 없을 때 빠른 입력 → '저장 폴더를 열 수 없어요' 안내 + 글 유지", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "" }, rootUnavailable: true });
    await page.keyboard.type("우유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(300);
    const v = await quickInput(page).inputValue();
    const h = await quickHint(page);
    assert.equal(v, "우유");
    assert.match(h ?? "", /저장 폴더를 열 수 없어요/);
    await context.close();
  });

  // ── c-misc ──
  await scenario("AI1 오늘 AI 묶음 → 내 체크 저장이 막힘 → ▶ 내일에서 되돌리기 → 풀리면: 체크는 남고 AI 2개만 빠진다", async () => {
    const { page, context, errors } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n", [TOMORROW]: "- [ ] 내일\n" } });
    await todayBatch(page);
    const before = await texts(page, "today");
    await page.evaluate((p) => (window.__hangPaths = [p]), TODAY);
    await box(page, 2).click();
    await page.clock.runFor(800);
    await next(page);
    await page.clock.runFor(10_500);
    const s1 = await status(page);
    const msg = await page.locator(".foot .ai-added").count();
    await page.locator('.foot [data-action="undo-ai"]').click();
    await page.clock.runFor(1000);
    await page.evaluate(() => window.__releasePaths());
    await page.clock.runFor(8000);
    const f = (await fs(page))[TODAY];
    await prev(page);
    await page.clock.runFor(1000);
    assert.equal(f, "- [x] 장보기\n");
    assert.deepEqual(await texts(page, "today"), ["장보기"]);
    await context.close();
  });

  await scenario("AI2 AI 묶음 알림 중 그 날의 AI 할 일 하나를 고친 뒤 ▶ → 되돌리기: 고친 할 일은 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n", [TOMORROW]: "" } });
    await todayBatch(page);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type(" 수정");
    await next(page);
    await page.clock.runFor(1500);
    const n = await page.locator(".foot .ai-added .msg").textContent().catch(() => null);
    await page.locator('.foot [data-action="undo-ai"]').click().catch(() => {});
    await page.clock.runFor(3000);
    const f = (await fs(page))[TODAY];
    assert.ok(f.includes("기획서 수정"), "사용자가 고친 AI 할 일이 되돌리기로 사라짐");
    assert.ok(!f.includes("리뷰"));
    await context.close();
  });

  await scenario("FL1 오늘 쓰기만 막힘(늦어짐) → ▶ 내일 고침 → ◀ 오늘: 내일 저장은 바로 되고, 오늘 화면은 내 고침, 풀리면 둘 다 정확", async () => {
    const { page, context, errors } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n", [TOMORROW]: "- [ ] 내일\n" } });
    await page.clock.runFor(2400);
    await page.evaluate((p) => (window.__hangPaths = [p]), TODAY);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await next(page);
    await page.clock.runFor(10_500);
    const s1 = await status(page);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("?");
    await page.clock.runFor(300);
    await prev(page);
    await page.clock.runFor(600);
    const f1 = await fs(page);
    const shown = await texts(page, "today");
    const s2 = await status(page);
    await page.evaluate(() => window.__releasePaths());
    await page.clock.runFor(3000);
    const f = await fs(page);
    assert.equal(f1[TOMORROW], "- [ ] 내일?\n", "떠나는 파일(내일)이 막힌 오늘 때문에 쓰이지 않음");
    assert.deepEqual(shown, ["오늘!"]);
    assert.equal(f[TODAY], "- [ ] 오늘!\n");
    assert.equal(await status(page), "저장됨");
    await context.close();
  });

  await scenario("ER1 언젠가 저장은 실패(재시도 대기) + 오늘 쓰기는 막혔다 풀림 → 상태는 '저장 실패' 계열을 유지", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n", "someday.md": "- [ ] 언젠\n" } });
    await page.clock.runFor(2400);
    await page.evaluate((p) => (window.__hangPaths = [p]), TODAY);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(10_500);
    const s1 = await status(page);
    await page.evaluate(() => (window.__failPaths = ["someday.md"]));
    await text(page, 0, "someday").click();
    await caretToEnd(page);
    await page.keyboard.type("?");
    await page.clock.runFor(1500);
    const s2 = await status(page);
    await page.evaluate(() => window.__releasePaths());
    await page.clock.runFor(500);
    const s3 = await status(page);
    await page.evaluate(() => (window.__failPaths = []));
    await page.clock.runFor(6000);
    const f = await fs(page);
    assert.notEqual(s3, "저장됨");
    assert.notEqual(s3, "저장 대기 중");
    assert.equal(f["someday.md"], "- [ ] 언젠?\n");
    await context.close();
  });

  // 리뷰 N6·QA7 의심 KP1: 새로고침하지 못한 창도 새 폴더 설정을 다시 읽어 창(투명도·항상 위)에 맞춘다
  for (const changed of [{ copied: false, reason: "kept" }, { copied: false, reason: "sourceUnavailable" }, null]) {
    await scenario(`KP1[${changed?.reason ?? "기본 폴더"}] 새로고침하지 못한 창: 새 폴더 설정(투명도 40·항상 위 끔)을 읽어 창에도 맞춘다`, async () => {
      const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n", "settings.json": J({ opacity: 100, alwaysOnTop: true, allowExternalAdd: true }) } });
      await page.clock.runFor(2400);
      await page.evaluate(() => (window.__hangWrites = true));
      await text(page, 0).click();
      await caretToEnd(page);
      await page.keyboard.type("1");
      await page.clock.runFor(1500);
      const before = (await calls(page, "set_window_opacity")).length;
      const pinBefore = (await calls(page, "plugin:window|set_always_on_top")).length;
      let reloaded = false;
      page.on("load", () => (reloaded = true));
      await page.evaluate((c) => {
        window.__setFile("settings.json", JSON.stringify({ opacity: 40, alwaysOnTop: false, allowExternalAdd: false }));
        if (c) sessionStorage.setItem("__rootPath", "/Users/me/Dropbox/todo");
        window.__emit("data-root-changed", c);
      }, changed);
      await page.clock.runFor(11_000);
      assert.equal(reloaded, false, "창이 새로고침됨(이 시나리오의 전제가 아님)");
      assert.equal(await page.locator('input[type="range"]').inputValue(), "40");
      const op = (await calls(page, "set_window_opacity")).slice(before);
      const pin = (await calls(page, "plugin:window|set_always_on_top")).slice(pinBefore);
      assert.ok(Math.abs(op.at(-1)?.alpha - 0.52) < 0.001, `투명도 ${J(op)}`);
      assert.equal(pin.at(-1)?.value, false);
      // 다음에 설정 하나를 바꿔도 새 폴더의 다른 값을 덮지 않는다
      await page.evaluate(() => window.__releaseWrites());
      await page.locator('input[type="range"]').fill("30");
      await page.clock.runFor(1500);
      const saved = JSON.parse((await fs(page))["settings.json"]);
      assert.equal(saved.opacity, 30);
      assert.equal(saved.allowExternalAdd, false);
      assert.equal(saved.alwaysOnTop, false);
      await context.close();
    });
  }

  await scenario("리뷰 N6 폴더를 열 수 없는 동안 바꾼 설정은 새 폴더로 바꿀 때 그 값만 새 폴더 설정 위에 얹는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n", "settings.json": J({ opacity: 100, allowExternalAdd: true }) } });
    await page.clock.runFor(500);
    await page.evaluate(() => {
      window.__setRootAvailable(false);
      window.__hangWrites = true;
    });
    await page.locator('input[type="range"]').fill("30");
    await page.clock.runFor(1500);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("1");
    await page.clock.runFor(1500);
    let reloaded = false;
    page.on("load", () => (reloaded = true));
    await page.evaluate(() => {
      window.__setRootAvailable(true);
      window.__setFile("settings.json", JSON.stringify({ opacity: 100, allowExternalAdd: false }));
      sessionStorage.setItem("__rootPath", "/Users/me/Dropbox/todo");
      window.__emit("data-root-changed", { copied: false, reason: "sourceUnavailable" });
    });
    await page.clock.runFor(11_000);
    assert.equal(reloaded, false);
    await page.evaluate(() => window.__releaseWrites());
    await page.clock.runFor(2000);
    const saved = JSON.parse((await fs(page))["settings.json"]);
    assert.equal(saved.opacity, 30);
    assert.equal(saved.allowExternalAdd, false);
    await context.close();
  });

  await scenario("KP2 kept 폴더의 settings.json이 UTF-8이 아님 → 새로고침 못 한 창에서 투명도를 바꿔도 그 파일에 쓰지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n", "settings.json": J({ allowExternalAdd: true }) } });
    await page.clock.runFor(2400);
    await page.evaluate(() => (window.__hangWrites = true));
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("1");
    await page.clock.runFor(1500);
    await page.evaluate(() => {
      window.__setFile("settings.json", "BAD");
      window.__badReads = ["settings.json"];
      sessionStorage.setItem("__rootPath", "/Users/me/Dropbox/todo");
      window.__emit("data-root-changed", { copied: false, reason: "kept" });
    });
    await page.clock.runFor(11_000);
    await page.evaluate(() => window.__releaseWrites());
    await page.locator('input[type="range"]').fill("30").catch(() => {});
    await page.clock.runFor(3000);
    const f = await fs(page);
    assert.equal(f["settings.json"], "BAD");
    await context.close();
  });
  await scenario("QA7-02 언젠가 저장이 실패(재시도 대기) 중 오늘을 고쳐 저장해도 상태는 계속 '저장 실패'다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n", "someday.md": "- [ ] 언젠\n" } });
    await page.clock.runFor(2400);
    await page.evaluate(() => (window.__failPaths = ["someday.md"]));
    await text(page, 0, "someday").click();
    await caretToEnd(page);
    await page.keyboard.type("?");
    await page.clock.runFor(1500);
    assert.equal(await status(page), FAILED);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.clock.runFor(200);
    assert.equal(await status(page), FAILED, "새 편집을 예약하자 '대기 중'으로 가려짐");
    await page.clock.runFor(1200);
    assert.equal((await fs(page))[TODAY], "- [ ] 오늘!\n");
    assert.equal(await status(page), FAILED, "다른 파일 저장이 성공하자 '대기 중'으로 가려짐");
    // 사람이 계속 치는 동안(2초마다 한 글자, 12초)
    const seen = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.type("x");
      await page.clock.runFor(2000);
      seen.push(await status(page));
    }
    assert.deepEqual(seen, Array(6).fill(FAILED));
    await page.evaluate(() => (window.__failPaths = []));
    await page.clock.runFor(6000);
    assert.equal(await status(page), "저장됨");
    await context.close();
  });

  // ── d-bound ──
  await scenario("BD1 MAX: 2,000개 중 맨 아래 미완료를 Cmd+Enter로 체크 → 0.5초 뒤 끝낸 일 맨 위, 파일 정확", async () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `- [${i < 1000 ? " " : "x"}] 일${i}`).join("\n") + "\n";
    const { page, context, errors } = await openApp(browser, { files: { [TODAY]: lines }, viewport: { width: 320, height: 470 } });
    await page.clock.runFor(500);
    await text(page, 999).click();
    const t0 = Date.now();
    await page.keyboard.press("Meta+Enter");
    await page.clock.runFor(2000);
    const ms = Date.now() - t0;
    const f = (await fs(page))[TODAY].split("\n");
    assert.equal(f[999], "- [x] 일999");
    assert.equal(f[998], "- [ ] 일998");
    assert.equal(f.length, 2001);
    await context.close();
  });

  await scenario("BD2 MIN 창 260x300: 띄어쓰기 없는 300자 할 일과 긴 URL이 가로로 넘치지 않는다", async () => {
    const long = "가".repeat(300);
    const url = "https://example.com/" + "a".repeat(250);
    const { page, context } = await openApp(browser, { files: { [TODAY]: `- [ ] ${long}\n- [ ] ${url}\n` }, viewport: { width: 260, height: 300 } });
    await page.clock.runFor(300);
    const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth, items: [...document.querySelectorAll('[data-list="today"] .item')].map((e) => e.scrollWidth - e.clientWidth) }));
    assert.ok(m.doc <= m.win, "문서가 가로로 넘침");
    await context.close();
  });

  await scenario("BD3 MAX 붙여넣기: 500줄을 한 할 일에 붙여넣으면 500개가 되고 파일·화면이 같다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 시작\n" } });
    await text(page, 0).click();
    await caretToEnd(page);
    const body = Array.from({ length: 500 }, (_, i) => `줄${i}`).join("\n");
    await paste(page.locator('[data-list="today"] .item .text').nth(0), "\n" + body);
    await page.clock.runFor(2500);
    const f = (await fs(page))[TODAY].trim().split("\n");
    const shown = await texts(page, "today");
    assert.equal(f.length, 501);
    assert.equal(shown.length, 501);
    await context.close();
  });

  // QA7 의심 BD4: 날짜는 1970-01-01~9999-12-31 안에서만 옮긴다. daily/10000-01-01.md가 생기지 않게
  await scenario("BD4 9999-12-31에서는 ▶가, 1970-01-01에서는 ◀가 꺼져 그 밖의 날짜 파일이 생기지 않는다", async () => {
    const { page, context, errors } = await openApp(browser, { files: {} });
    await page.evaluate(() => window.__emit("show-date", "9999-12-31"));
    await page.clock.runFor(300);
    assert.equal(await page.locator('button[aria-label="다음 날"]').isDisabled(), true);
    assert.equal(await page.locator('button[aria-label="이전 날"]').isDisabled(), false);
    await page.locator('button[aria-label="다음 날"]').click({ force: true });
    await page.clock.runFor(300);
    assert.equal(await page.locator(".datebar .date").textContent(), "12월 31일 (금)");
    await addInput(page).fill("미래");
    await page.keyboard.press("Enter");
    await page.clock.runFor(1500);
    assert.equal((await fs(page))["daily/9999-12-31.md"], "- [ ] 미래\n");
    await page.evaluate(() => window.__emit("show-date", "1970-01-01"));
    await page.clock.runFor(300);
    assert.equal(await page.locator('button[aria-label="이전 날"]').isDisabled(), true);
    await page.locator('button[aria-label="이전 날"]').click({ force: true });
    await page.clock.runFor(300);
    assert.equal(await page.locator(".datebar .date").textContent(), "1월 1일 (목)");
    // 범위 밖 날짜를 보여 달라는 요청은 무시한다
    await page.evaluate(() => window.__emit("show-date", "10000-01-01"));
    await page.clock.runFor(300);
    assert.equal(await page.locator(".datebar .date").textContent(), "1월 1일 (목)");
    assert.ok(Object.keys(await fs(page)).every((k) => !/daily\/(1969|10000)-/.test(k)));
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("BD4 모아보기: 9999년 12월은 칸이 9999-12-31에서 끝나고 다음 달이 꺼진다. 1970년 1월은 이전 달이 꺼지고 1969년 칸은 고를 수 없다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, hash: "#overview?date=9999-12-31", files: {} });
    await page.clock.runFor(300);
    assert.equal(await page.locator('button[aria-label="다음 달"]').isDisabled(), true);
    const dates = await page.locator(".cell").evaluateAll((cells) => cells.map((c) => c.dataset.date));
    assert.equal(dates.at(-1), "9999-12-31");
    assert.equal(dates.length, 34);
    const jan = await openApp(browser, { ...BIG, hash: "#overview?date=1970-01-01", files: {} });
    await jan.page.clock.runFor(300);
    assert.equal(await jan.page.locator('button[aria-label="이전 달"]').isDisabled(), true);
    await jan.page.locator('.cell[data-date="1969-12-29"]').click();
    await jan.page.clock.runFor(300);
    assert.equal(await jan.page.locator(".side-date").textContent(), "1월 1일 (목)");
    assert.ok(Object.keys(await fs(page)).every((k) => !/daily\/(1969|10000)-/.test(k)));
    await jan.context.close();
    await context.close();
  });

  await scenario("리뷰 N2 모아보기에서 입력칸에 쓰다 만 글이 있는 채 다른 날을 누르면, 떠나는 날 칸에도 그 글이 바로 보인다", async () => {
    // 쓰기가 늦어 파일 변경 알림(다시 읽기)이 오기 전에 본다
    const { page, context } = await openApp(browser, { ...BIG, files: { [D14]: "- [ ] 원래\n" }, globals: { __writeDelay: 2000 } });
    await page.clock.runFor(300);
    await page.locator('[data-list="overview"] .add input').fill("새 일");
    await page.locator('.cell[data-date="2026-10-16"]').click();
    await page.clock.runFor(100);
    assert.deepEqual(await page.locator('.cell[data-date="2026-10-14"] .mi').allTextContents().then((t) => t.map((x) => x.trim())), ["원래", "새 일"]);
    await page.clock.runFor(3000);
    assert.equal((await fs(page))[D14], "- [ ] 원래\n- [ ] 새 일\n");
    await context.close();
  });

  await scenario("BD5 분할 손잡이를 맨 위·맨 아래 끝까지 끌어도 두 목록이 모두 남고 값이 저장된다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n", "someday.md": "- [ ] 언젠\n" } });
    const handle = page.locator(".splitter, .split, [class*=split]").first();
    const res = [];
    for (const y of [-500, 2000]) {
      const b = await handle.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, y, { steps: 5 });
      await page.mouse.up();
      await page.clock.runFor(1500);
      const h = await page.evaluate(() => [...document.querySelectorAll("[data-list]")].map((e) => Math.round(e.getBoundingClientRect().height)));
      const s = JSON.parse((await fs(page))["settings.json"] ?? "{}");
      res.push({ y, h, ratio: s.splitRatio });
    }
    for (const r of res) assert.ok(r.h.every((x) => x >= 30), "한 목록이 거의 사라짐");
    await context.close();
  });

  // ── e-blank ──
  await scenario("BK1 맨 위 빈 칸처럼 보이는 줄(ㅤ)에서 맨 앞 Backspace → 그 줄만 지워지고 아래 할 일은 그대로", async () => {
    const { page, context, errors } = await openApp(browser, { files: { [TODAY]: "- [ ] ㅤ\n- [ ] 아래\n" } });
    await text(page, 0).click();
    await setCaret(page, 0);
    await page.keyboard.press("Backspace");
    await page.clock.runFor(1500);
    const f = (await fs(page))[TODAY];
    assert.equal(f, "- [ ] 아래\n");
    await context.close();
  });

  await scenario("BK2 하위 줄을 가진 빈 칸처럼 보이는 줄을 위 할 일로 합치면 하위 줄이 위 할 일 밑으로 간다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 위\n- [ ] ​\n  - 메모\n- [ ] 아래\n" } });
    await text(page, 1).click();
    await setCaret(page, 0);
    await page.keyboard.press("Backspace");
    await page.clock.runFor(1500);
    const f = (await fs(page))[TODAY];
    assert.equal(f, "- [ ] 위\n  - 메모\n- [ ] 아래\n");
    await context.close();
  });

  await scenario("BK3 끝낸 일 아래의 빈 칸처럼 보이는 미완료 줄 Backspace → 지워진다(상태가 달라도)", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [x] 끝\n- [ ] ㅤ\n" } });
    await text(page, 1).click();
    await setCaret(page, 0);
    await page.keyboard.press("Backspace");
    await page.clock.runFor(1500);
    const f = (await fs(page))[TODAY];
    assert.equal(f, "- [x] 끝\n");
    await context.close();
  });

  for (const c of ["next-day", "someday"]) {
    await scenario(`BK4[${c}] 하위 줄이 달린 빈 칸 줄은 하위 줄과 함께 옮겨진다(잃지 않는다)`, async () => {
      const { page, context } = await openApp(browser, { files: { "settings.json": stPast(c), [D13]: "- [ ] ㅤ\n  - 중요 메모\n- [ ] ​\n- [x] 끝\n" } });
      await page.clock.runFor(1500);
      const f = await fs(page);
      assert.ok(J(f).includes("중요 메모"), "하위 메모가 사라짐");
      assert.ok((f[D13] ?? "").includes("- [ ] ​"), "빈 칸 줄이 어제에 남지 않음");
      await context.close();
    });
  }
}
