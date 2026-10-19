// 라운드 6 QA(QA6-01~04, 의심: 앞 글 안내)와 5차 코드 리뷰(N1·N4, LOW 중복 앞 글·읽는 중 종료)에서 나온 경우들. QA6 시나리오를 옮기고 리뷰 항목을 더했다
import assert from "node:assert/strict";
import { caretToEnd, fs, openApp, scenario, setCaret, status, texts } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
const YESTERDAY = "daily/2026-10-13.md";
const TOMORROW = "daily/2026-10-15.md";
const J = JSON.stringify;
const QUICK = { hash: "#quick", viewport: { width: 620, height: 96 } };
const SLOW = "저장이 늦어지고 있어요…";
const SELECT_ALL = process.platform === "darwin" ? "Meta+A" : "Control+A";
const NOW = Math.floor(new Date("2026-10-14T10:00:00").getTime() / 1000);

const text = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .text`).nth(i);
const quickInput = (page) => page.locator(".quick input");
const quickHint = async (page) => (await page.locator(".quick .hint").textContent()).trim();
const nextDay = (page) => page.locator('button[aria-label="다음 날"]').click();
const prevDay = (page) => page.locator('button[aria-label="이전 날"]').click();
const settingsFile = (carryOver) => J({ carryOver, lastRolloverDate: "2026-10-13" });

/** 10/15에 AI가 2개를 넣었다고 알림이 뜬 상태로 만든다 */
async function tomorrowBatch(page) {
  await page.evaluate(
    ([p, c, b]) => {
      window.__setFile(p, c);
      window.__aiBatches = [b];
    },
    [
      TOMORROW,
      `- [ ] 기획서 <!-- ai:claude-code@${NOW + 5} -->\n- [ ] 리뷰 <!-- ai:claude-code@${NOW + 5} -->\n- [ ] 원래 일\n`,
      { by: "claude-code", at: NOW + 5, path: TOMORROW, count: 2 },
    ],
  );
  await page.clock.runFor(3500);
  assert.equal(await page.locator(".foot .ai-added .msg").textContent(), "10/15에 AI 2개 추가");
}

/** kept 폴더로 바꾸는데 할 일 저장이 끝나지 않아 창이 새로고침되지 못한 상태를 만든다 */
async function keptWithoutReload(page, theirs, wait) {
  await text(page, 0).click();
  await caretToEnd(page);
  await page.keyboard.type("1");
  await page.clock.runFor(1500);
  let reloaded = false;
  page.on("load", () => (reloaded = true));
  await page.evaluate((s) => {
    window.__setFile("settings.json", s);
    sessionStorage.setItem("__rootPath", "/Users/me/Dropbox/todo");
    window.__emit("data-root-changed", { copied: false, reason: "kept" });
  }, theirs);
  await page.clock.runFor(wait);
  assert.equal(reloaded, false, "창이 새로고침됨(이 시나리오의 전제가 아님)");
  assert.match(await page.locator(".foot").textContent(), /아직 저장하지 못했어요/);
}

export default async function (browser) {
  // ── QA6-01·리뷰 N3: 넣는 중에 칸을 비웠는데 저장이 실패 ──
  await scenario("QA6-01 '우유' Enter → 저장 중 칸을 비움 → 저장 실패: '우유'가 칸에 돌아온다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400, __failWrites: true } });
    await page.keyboard.type("우유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.keyboard.press(SELECT_ALL);
    await page.keyboard.press("Backspace");
    await page.clock.runFor(800);
    assert.equal(await quickInput(page).inputValue(), "우유");
    assert.equal(await quickHint(page), "저장하지 못했어요");
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(50);
    assert.equal(await quickInput(page).inputValue(), "우유", "다시 띄우면 사라짐");
    await context.close();
  });

  await scenario("QA6-01 '우유' Enter → 저장 중 칸을 지우고 공백 하나만 침 → 저장 실패: '우유'가 칸에 돌아온다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400, __failWrites: true } });
    await page.keyboard.type("우유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.keyboard.press(SELECT_ALL);
    await page.keyboard.press("Backspace");
    await page.keyboard.type(" ");
    await page.clock.runFor(800);
    assert.equal(await quickInput(page).inputValue(), "우유");
    await context.close();
  });

  await scenario("리뷰 LOW 앞 창의 Enter가 실패할 때 새 창 칸에 같은 글이 있으면 따로 들고 있지 않는다(같은 글이 두 번 돌아오지 않음)", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400, __failWrites: true } });
    await page.keyboard.type("우유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(20);
    await page.keyboard.type("우유");
    await page.clock.runFor(800);
    await page.evaluate(() => (window.__failWrites = false));
    await page.keyboard.press("Enter");
    await page.clock.runFor(500);
    assert.equal((await fs(page))[TODAY], "- [ ] 우유\n- [ ] 원래\n");
    assert.equal(await quickHint(page), "추가됨", "같은 글이 앞 글로 한 번 더 돌아옴");
    await context.close();
  });

  await scenario("QA6 의심 앞 글과 지금 글이 모두 실패한 뒤 Esc로 닫았다 다시 띄우면 지금 글과 함께 앞 글 안내도 보인다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400 } });
    await page.keyboard.type("첫 번째");
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(20);
    await page.keyboard.type("두 번째");
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
    await page.evaluate(() => (window.__failWrites = true));
    await page.clock.runFor(1000);
    await page.evaluate(() => (window.__failWrites = false));
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(50);
    assert.equal(await quickInput(page).inputValue(), "두 번째");
    assert.match(await quickHint(page), /앞 글.*첫 번째/);
    await context.close();
  });

  // ── QA6-02: 자정 정리와 다른 편집기가 쓴 빈 칸 줄 ──
  await scenario("QA6-02 '다음 날로': 어제 파일의 '- [ ] ㅤ'(U+3164) 줄은 옮기지 않고 어제 파일에 그대로 남는다", async () => {
    const files = { [YESTERDAY]: "- [ ] a\n- [ ] ㅤ\n- [x] 끝\n", "settings.json": settingsFile("next-day") };
    const { page, context } = await openApp(browser, { files });
    await page.clock.runFor(2500);
    const f = await fs(page);
    assert.equal(f[YESTERDAY], "- [ ] ㅤ\n- [x] 끝\n");
    assert.equal(f[TODAY], "- [ ] a <!-- from:2026-10-13 -->\n");
    await context.close();
  });

  await scenario("QA6-02 '언젠가로': 어제 파일의 ZWSP만 든 줄도 어제 파일에 남는다", async () => {
    const files = { [YESTERDAY]: "- [ ] a\n- [ ] ​\n", "settings.json": settingsFile("someday"), "someday.md": "- [ ] s\n" };
    const { page, context } = await openApp(browser, { files });
    await page.clock.runFor(2500);
    const f = await fs(page);
    assert.equal(f[YESTERDAY], "- [ ] ​\n");
    assert.equal(f["someday.md"], "- [ ] s\n- [ ] a <!-- from:2026-10-13 -->\n");
    await context.close();
  });

  // ── QA6-03 ──
  await scenario("QA6-03 '위' 아래 빈 칸처럼 보이는 줄(U+3164)의 맨 앞 Backspace는 빈 칸을 지운 것처럼 '위'만 남긴다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 위\n- [ ] ㅤ\n- [ ] 아래\n" } });
    await page.clock.runFor(2400);
    await text(page, 1).click();
    await setCaret(page, 0);
    await page.keyboard.press("Backspace");
    await page.clock.runFor(1500);
    assert.deepEqual(await texts(page, "today"), ["위", "아래"]);
    assert.equal((await fs(page))[TODAY], "- [ ] 위\n- [ ] 아래\n");
    await context.close();
  });

  // ── QA6-04: kept 폴더로 바꾼 뒤 창이 새로고침되지 못함 ──
  await scenario("QA6-04 kept 폴더로 바꿀 때 할 일 쓰기가 실패해 창이 남아도, 투명도를 바꾸면 새 폴더 설정의 다른 값은 그대로다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n", "settings.json": J({ allowExternalAdd: true, carryOver: "keep", sortChecked: true }) } });
    await page.clock.runFor(2400);
    await page.evaluate(() => (window.__beforeWrite = (a) => { if (a.path.endsWith(".md")) throw "디스크 오류(모의)"; }));
    await keptWithoutReload(page, J({ allowExternalAdd: false, carryOver: "someday", sortChecked: false, opacity: 80 }), 2000);
    await page.locator('input[type="range"]').fill("40");
    await page.clock.runFor(2500);
    const s = JSON.parse((await fs(page))["settings.json"]);
    assert.equal(s.allowExternalAdd, false, "새 폴더의 allowExternalAdd를 이 창 값으로 덮음");
    assert.equal(s.carryOver, "someday", "새 폴더의 carryOver를 덮음");
    assert.equal(s.sortChecked, false);
    assert.equal(s.opacity, 40);
    await context.close();
  });

  await scenario("QA6-04 kept 폴더로 바꿀 때 할 일 쓰기가 응답이 없어 창이 남아도, 투명도를 바꾸면 새 폴더 설정의 다른 값은 그대로다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n", "settings.json": J({ allowExternalAdd: true }) } });
    await page.clock.runFor(2400);
    await page.evaluate(() => (window.__hangWrites = true));
    await keptWithoutReload(page, J({ allowExternalAdd: false, carryOver: "next-day" }), 11_000);
    await page.locator('input[type="range"]').fill("55");
    await page.clock.runFor(2500);
    const s = JSON.parse((await fs(page))["settings.json"]);
    assert.equal(s.allowExternalAdd, false, "새 폴더의 allowExternalAdd를 덮음");
    assert.equal(s.carryOver, "next-day", "새 폴더의 carryOver를 덮음");
    assert.equal(s.opacity, 55);
    await context.close();
  });

  // ── 리뷰 N1: 날짜를 옮기며 목록을 비워도 AI 알림·되돌리기는 그대로 ──
  await scenario("N1 AI 알림이 뜬 날짜로 이동해도(읽는 동안 목록이 비어도) 알림이 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    await tomorrowBatch(page);
    await page.evaluate(() => (window.__readDelay = 2000));
    await nextDay(page);
    await page.clock.runFor(100);
    assert.equal(await page.locator(".foot .ai-added").count(), 1, "읽는 동안 알림이 사라짐");
    await page.clock.runFor(3000);
    assert.deepEqual(await texts(page, "today"), ["기획서", "리뷰", "원래 일"]);
    assert.equal(await page.locator(".foot .ai-added").count(), 1, "다 읽은 뒤 알림이 사라짐");
    await context.close();
  });

  await scenario("N1 그 날짜를 읽는 중에 누른 '되돌리기'도 그 묶음을 지운다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    await tomorrowBatch(page);
    await page.evaluate(() => (window.__readDelay = 2000));
    await nextDay(page);
    await page.clock.runFor(100);
    await page.locator('.foot [data-action="undo-ai"]').click();
    await page.clock.runFor(9000);
    assert.equal((await fs(page))[TOMORROW], "- [ ] 원래 일\n");
    assert.deepEqual(await texts(page, "today"), ["원래 일"]);
    assert.equal(await page.locator(".foot .ai-added").count(), 0);
    await context.close();
  });

  // ── 리뷰 N4: 이미 막힌 쓰기를 날짜를 옮길 때마다 다시 기다리지 않는다 ──
  await scenario("N4 쓰기가 막혀 '늦어짐'이 뜬 뒤에는 ◀로 돌아올 때 다시 10초를 기다리지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n", [TOMORROW]: "- [ ] 내일\n" } });
    await page.clock.runFor(2400);
    await page.evaluate(() => (window.__hangWrites = true));
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await nextDay(page);
    await page.clock.runFor(10_500);
    assert.deepEqual(await texts(page, "today"), ["내일"]);
    assert.equal(await status(page), SLOW);
    await prevDay(page);
    await page.clock.runFor(500);
    assert.deepEqual(await texts(page, "today"), ["오늘!"], "막힌 쓰기를 다시 기다림");
    await page.evaluate(() => window.__releaseWrites());
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] 오늘!\n");
    await context.close();
  });

  // ── 리뷰 LOW: 날짜를 옮기며 "불러오는 중…"인 동안 종료 ──
  await scenario("LOW 입력칸에 쓰다 만 글은 날짜를 옮길 때 떠나는 날에 넣는다 — 읽는 중에 종료해도 잃지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n", [TOMORROW]: "- [ ] 내일\n" } });
    await page.clock.runFor(2400);
    await page.evaluate(() => (window.__readDelay = 3000));
    await page.locator('[data-list="today"] .add input').fill("쓰다 만 일");
    await nextDay(page);
    await page.clock.runFor(100);
    await page.evaluate(() => window.__emit("quit-requested"));
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] 오늘\n- [ ] 쓰다 만 일\n", J(await fs(page)));
    await page.clock.runFor(3000);
    assert.deepEqual(await texts(page, "today"), ["내일"]);
    assert.equal(await page.locator('[data-list="today"] .add input').inputValue(), "");
    await context.close();
  });
}
