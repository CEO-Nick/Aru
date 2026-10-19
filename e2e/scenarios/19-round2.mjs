import assert from "node:assert/strict";
import { calls, caretToEnd, fs, openApp, paste, scenario, setCaret, status, texts } from "../harness.mjs";

// 라운드 2 QA·코드 리뷰에서 찾은 문제의 회귀 시나리오
const TODAY = "daily/2026-10-14.md";
const YESTERDAY = "daily/2026-10-13.md";
const BIG = { hash: "#overview", viewport: { width: 1180, height: 760 } };
const QUICK = { hash: "#quick", viewport: { width: 620, height: 96 } };
const NOW = Math.floor(new Date("2026-10-14T10:00:00").getTime() / 1000);
const J = JSON.stringify;
const isMac = process.platform === "darwin";
const CMD_ENTER = isMac ? "Meta+Enter" : "Control+Enter";

const writesTo = async (page, path) => (await calls(page, "write_text")).filter((a) => a.path === path);
const box = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .box`).nth(i);
const text = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .text`).nth(i);

async function add(page, value, list = "today") {
  const input = page.locator(`[data-list="${list}"] .add input`);
  await input.fill(value);
  await input.press("Enter");
  await page.clock.runFor(10);
}

async function dragTo(page, fromSelector, target) {
  const from = page.locator(fromSelector);
  await from.hover();
  const grip = await from.locator(".grip").boundingBox();
  const to = await page.locator(target).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.clock.runFor(10);
}

export default async function (browser) {
  // QA2-01
  await scenario("폴더가 늦게 붙은 뒤 자정 정리로 옮긴 어제 일이 오늘 화면에 보이고, 다음 편집에도 남는다", async () => {
    const files = {
      "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-13" }),
      [YESTERDAY]: "- [ ] 어제 미완료\n- [x] 어제 끝냄\n",
      [TODAY]: "- [ ] 오늘 원래\n",
    };
    const { page, context } = await openApp(browser, { files, rootUnavailable: true });
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(3200);
    assert.deepEqual(await texts(page, "today"), ["오늘 원래", "어제 미완료"]);
    await add(page, "새로 적음");
    await page.clock.runFor(1500);
    const f = await fs(page);
    assert.equal(f[TODAY], "- [ ] 오늘 원래\n- [ ] 어제 미완료 <!-- from:2026-10-13 -->\n- [ ] 새로 적음\n");
    assert.equal(f[YESTERDAY], "- [x] 어제 끝냄\n");
    await context.close();
  });

  await scenario("폴더가 없는 동안 자정이 지나도, 폴더가 돌아오면 어제 미완료가 오늘 화면과 파일에 함께 보인다", async () => {
    const files = { "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-14" }), [TODAY]: "- [ ] 오늘 미완료\n- [x] 끝냄\n" };
    const { page, context } = await openApp(browser, { files, now: "2026-10-14T23:59:00" });
    await page.evaluate(() => window.__setRootAvailable(false));
    await page.clock.runFor(3100);
    await page.clock.runFor(60_000);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(3200);
    assert.deepEqual(await texts(page, "today"), ["오늘 미완료"]);
    assert.equal((await fs(page))["daily/2026-10-15.md"], "- [ ] 오늘 미완료 <!-- from:2026-10-14 -->\n");
    await context.close();
  });

  // QA2-02
  await scenario("못 읽던 파일이 다시 읽히면 밀린 저장을 그 사이 바깥에서 고친 내용과 합친다(덮어쓰지 않는다)", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    await page.clock.runFor(2400);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type(" 고침");
    await page.evaluate(() => (window.__badReads = ["daily/2026-10-14.md"]));
    await page.clock.runFor(1200);
    await page.evaluate((p) => {
      window.__badReads = [];
      window.__setFile(p, "- [ ] 하나\n- [ ] 외부에서 추가\n");
    }, TODAY);
    await page.clock.runFor(3100);
    await page.clock.runFor(5100);
    const f = (await fs(page))[TODAY];
    assert.equal(f, "- [ ] 하나 고침\n- [ ] 외부에서 추가\n");
    assert.deepEqual(await texts(page, "today"), ["하나 고침", "외부에서 추가"]);
    await context.close();
  });

  await scenario("잠깐의 읽기 오류(EIO)는 목록을 비우거나 막지 않고, 고치던 글을 지킨 채 다음에 다시 읽는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    await page.clock.runFor(2400);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.evaluate(() => (window.__flakyReads = ["daily/2026-10-14.md"]));
    await page.keyboard.type(" 중요한 메모");
    await page.clock.runFor(700);
    assert.deepEqual(await texts(page, "today"), ["하나 중요한 메모"]);
    assert.equal(await page.locator('[data-list="today"] .add input').count(), 1, "잠깐의 오류로 입력을 막았다");
    await page.evaluate(() => (window.__flakyReads = []));
    await page.clock.runFor(3100);
    assert.equal((await fs(page))[TODAY], "- [ ] 하나 중요한 메모\n");
    assert.equal(await status(page), "저장됨");
    await context.close();
  });

  // QA2-03
  await scenario("오래된 지난 날짜 파일 하나를 못 읽어도 나머지 날의 미완료는 옮기고, 그 파일을 알리며 쓰지 않는다", async () => {
    const files = {
      "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-11" }),
      "daily/2026-10-11.md": "깨짐",
      [YESTERDAY]: "- [ ] 어제 미완료\n",
    };
    const { page, context } = await openApp(browser, { files, globals: { __badReads: ["daily/2026-10-11.md"] } });
    await page.clock.runFor(100);
    assert.deepEqual(await texts(page, "today"), ["어제 미완료"]);
    assert.equal(await status(page), "읽지 못한 파일이 있어요: daily/2026-10-11.md");
    assert.deepEqual(await writesTo(page, "daily/2026-10-11.md"), []);
    const f = await fs(page);
    assert.equal(f[YESTERDAY], undefined);
    // 못 읽은 날만 다음에 다시 하도록 남긴다(정리한 날은 다시 정리하지 않는다)
    assert.equal(JSON.parse(f["settings.json"]).lastRolloverDate, "2026-10-14");
    assert.deepEqual(JSON.parse(f["settings.json"]).rolloverPending, ["2026-10-11"]);
    // 고쳐서 읽히게 되면 다음 정리(여기서는 저장 폴더가 다시 붙을 때) 때 옮겨진다
    await page.evaluate(() => {
      window.__badReads = [];
      window.__setFile("daily/2026-10-11.md", "- [ ] 오래된 일\n");
      window.__setRootAvailable(false);
    });
    await page.clock.runFor(3100);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(3100);
    assert.deepEqual(await texts(page, "today"), ["어제 미완료", "오래된 일"]);
    assert.equal(JSON.parse((await fs(page))["settings.json"]).lastRolloverDate, "2026-10-14");
    assert.equal(JSON.parse((await fs(page))["settings.json"]).rolloverPending, undefined);
    await context.close();
  });

  // QA2-04·05, N12
  await scenario("같은 글자의 할 일이 둘이어도 다른 항목을 체크했을 때 소제목이 제자리에 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 메일\n## 오후\n- [ ] 메일\n- [ ] 운동\n" } });
    await box(page, 2).click();
    await page.clock.runFor(700);
    assert.equal((await fs(page))[TODAY], "- [ ] 메일\n## 오후\n- [ ] 메일\n- [x] 운동\n");
    await context.close();
  });

  await scenario("소제목 아래 할 일의 글자를 고치고 저장된 뒤 다른 할 일을 체크해도 소제목은 고친 할 일 위에 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n## 오후\n- [ ] b\n- [ ] c\n" } });
    await text(page, 1).click();
    await caretToEnd(page);
    await page.keyboard.type("2");
    await page.clock.runFor(1500);
    await box(page, 0).click();
    await page.clock.runFor(700);
    assert.equal((await fs(page))[TODAY], "## 오후\n- [ ] b2\n- [ ] c\n- [x] a\n");
    await context.close();
  });

  await scenario("빠른 입력: 끝낸 일과 같은 글자를 넣어도 그 위 소제목은 따라오지 않는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] a\n## 오후\n- [x] b\n" } });
    await page.locator(".quick input").fill("b");
    await page.locator(".quick input").press("Enter");
    await page.clock.runFor(400);
    assert.equal((await fs(page))[TODAY], "- [ ] b\n- [ ] a\n## 오후\n- [x] b\n");
    await context.close();
  });

  // CRLF·BOM: aru 명령과 같은 규칙
  await scenario("CRLF·BOM 파일은 빠른 입력과 작은 창 저장 뒤에도 CRLF·BOM 그대로다", async () => {
    const src = "﻿# 제목\r\n\r\n- [ ] a\r\n\r\n메모\r\n";
    const q = await openApp(browser, { ...QUICK, files: { [TODAY]: src } });
    await q.page.locator(".quick input").fill("새");
    await q.page.locator(".quick input").press("Enter");
    await q.page.clock.runFor(400);
    assert.equal((await fs(q.page))[TODAY], "﻿# 제목\r\n\r\n- [ ] 새\r\n- [ ] a\r\n\r\n메모\r\n");
    await q.context.close();
    const { page, context } = await openApp(browser, { files: { [TODAY]: src } });
    await box(page, 0).click();
    await page.clock.runFor(700);
    assert.equal((await fs(page))[TODAY], "﻿# 제목\r\n\r\n- [x] a\r\n\r\n메모\r\n");
    await context.close();
  });

  await scenario("닫히지 않은 코드 펜스(``` 한 줄) 아래 할 일도 보인다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 위\n```\n- [ ] 아래\n" } });
    assert.deepEqual(await texts(page, "today"), ["위", "아래"]);
    await context.close();
  });

  // QA2-06
  await scenario("AI 할 일에 내 할 일을 Backspace로 합치면 AI 표시가 사라져, 되돌리기가 내 글을 지우지 않는다", async () => {
    const m = `ai:codex@${NOW - 5}`;
    const { page, context } = await openApp(browser);
    await page.evaluate(
      ([t, m]) => {
        window.__setFile(t, `- [ ] AI가 넣음 <!-- ${m} -->\n- [ ] AI 둘 <!-- ${m} -->\n- [ ] 내가 쓴 중요한 글\n`);
        window.__emit("file-changed", { path: t, source: "cli" });
      },
      [TODAY, m],
    );
    await page.clock.runFor(3100);
    await text(page, 2).click();
    await setCaret(page, 0);
    await page.keyboard.press("Backspace");
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], `- [ ] AI가 넣음 <!-- ${m} -->\n- [ ] AI 둘 내가 쓴 중요한 글\n`);
    await page.locator('[data-action="undo-ai"]').click();
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] AI 둘 내가 쓴 중요한 글\n");
    await context.close();
  });

  // QA2-07
  await scenario("모아보기: '옮기지 못했어요'라고 알린 옮기기는 나중에 몰래 써지지 않는다(항목이 둘이 되지 않음)", async () => {
    const files = { "someday.md": "- [ ] 여권\n- [ ] 남김\n", "daily/2026-10-20.md": "- [ ] 원래\n" };
    const { page, context } = await openApp(browser, { ...BIG, files });
    await page.evaluate(() => window.__setRootAvailable(false));
    await page.clock.runFor(15100);
    await page.evaluate(() => window.__setRootAvailable(true));
    await dragTo(page, '[data-list="someday"] .item >> nth=0', '.cell[data-date="2026-10-20"]');
    assert.equal(await status(page), "옮기지 못했어요: 저장 폴더를 열 수 없어요");
    await page.clock.runFor(3100);
    const f = await fs(page);
    assert.equal(f["daily/2026-10-20.md"], "- [ ] 원래\n");
    assert.deepEqual(await texts(page, "someday"), ["여권", "남김"]);
    await context.close();
  });

  // QA2-08
  await scenario("폴더가 없는 동안 체크(아래로 정렬)한 할 일을 다른 기기가 글자만 고쳤으면 한 줄로 합친다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n- [ ] 운동\n- [ ] 독서\n" } });
    await page.evaluate(() => window.__setRootAvailable(false));
    await box(page, 0).click();
    await page.clock.runFor(700);
    await page.evaluate((p) => window.__setFile(p, "- [ ] 장보기 우유\n- [ ] 운동\n- [ ] 독서\n"), TODAY);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(3100);
    assert.equal((await fs(page))[TODAY], "- [ ] 운동\n- [ ] 독서\n- [x] 장보기 우유\n");
    assert.deepEqual(await texts(page, "today"), ["운동", "독서", "장보기 우유"]);
    await context.close();
  });

  await scenario("같은 글자 할 일 둘 중 내가 위의 것을 체크하고 다른 기기가 아래 것을 고쳐도 체크는 제 줄에 남는다", async () => {
    const files = { [TODAY]: "- [ ] 회의\n- [ ] 메일\n- [ ] 회의\n", "settings.json": J({ sortChecked: false }) };
    const { page, context } = await openApp(browser, { files });
    await page.evaluate(() => window.__setRootAvailable(false));
    await box(page, 0).click();
    await page.clock.runFor(700);
    await page.evaluate((p) => window.__setFile(p, "- [ ] 회의\n- [ ] 메일\n- [ ] 회의 2시\n"), TODAY);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(3100);
    assert.equal((await fs(page))[TODAY], "- [x] 회의\n- [ ] 메일\n- [ ] 회의 2시\n");
    await context.close();
  });

  // 리뷰: 앱과 aru 명령의 동시 쓰기
  await scenario("저장 직전 aru 명령이 같은 파일에 넣은 줄을 앱의 자동저장이 덮어쓰지 않고, 화면에도 보인다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    await page.clock.runFor(2500);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type(" 고침");
    // 3초 확인보다 1초 저장이 먼저 온다. 그 사이 aru add가 끼어든다
    await page.evaluate((p) => (window.__interleave = { [p]: "- [ ] AI 추가\n- [ ] 하나\n" }), TODAY);
    await page.clock.runFor(1100);
    assert.equal((await fs(page))[TODAY], "- [ ] AI 추가\n- [ ] 하나 고침\n");
    assert.deepEqual(await texts(page, "today"), ["AI 추가", "하나 고침"]);
    const conditional = (await writesTo(page, TODAY)).filter((a) => "expected" in a);
    assert.ok(conditional.length >= 2, `조건부 쓰기를 쓰지 않았다: ${J(conditional)}`);
    await context.close();
  });

  await scenario("빠른 입력도 읽은 뒤 쓰기 전에 aru 명령이 넣은 줄을 지우지 않는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" } });
    await page.evaluate((p) => (window.__interleave = { [p]: "- [ ] CLI\n- [ ] 원래\n" }), TODAY);
    await page.locator(".quick input").fill("빠른");
    await page.locator(".quick input").press("Enter");
    await page.clock.runFor(400);
    assert.equal((await fs(page))[TODAY], "- [ ] 빠른\n- [ ] CLI\n- [ ] 원래\n");
    await context.close();
  });

  await scenario("저장 폴더 잠금이 풀리지 않아 저장이 거절되면(잠깐의 오류) 고친 내용을 지키고 다시 시도해 저장한다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" }, globals: { __lockBusy: true } });
    await add(page, "둘");
    await page.clock.runFor(100);
    assert.match(await status(page), /^저장 실패/);
    assert.deepEqual(await texts(page, "today"), ["하나", "둘"]);
    await page.evaluate(() => (window.__lockBusy = false));
    await page.clock.runFor(5100);
    assert.equal((await fs(page))[TODAY], "- [ ] 하나\n- [ ] 둘\n");
    await context.close();
  });

  // 리뷰: 저장 폴더 변경 경합
  await scenario("폴더가 돌아오는지 확인하는 중에 '기본 폴더 쓰기'를 눌러도 밀린 편집을 쓴 뒤에야 창을 새로 연다", async () => {
    const { page, context } = await openApp(browser, { rootUnavailable: true });
    await add(page, "잃으면 안 됨");
    await page.evaluate(() => {
      window.__setRootAvailable(true);
      window.__readDelay = 400;
    });
    // 3초 주기: 목록 다시 읽기(0.4초) 뒤 폴더 확인이 시작돼, 확인 안의 느린 읽기를 기다리는 중
    await page.clock.runFor(3600);
    assert.equal(await status(page), "저장 폴더를 열 수 없어요", "확인이 이미 끝났다(경합이 재현되지 않음)");
    await page.evaluate(() => (window.__beforeSwitch = true));
    await page.locator('.foot [data-action="default-folder"]').click();
    await page.clock.runFor(1000);
    await page.waitForSelector(".foot");
    // 진행 중이던 확인을 함께 기다려 밀린 편집을 쓰고 나서 창을 새로 열었다(멈춰 남지 않았다)
    assert.equal(await page.evaluate(() => window.__beforeSwitch), undefined, "폴더를 바꾼 뒤 창을 새로 열지 않았다");
    await page.evaluate(() => (window.__readDelay = 0));
    await page.clock.runFor(1000);
    assert.equal((await fs(page))[TODAY], "- [ ] 잃으면 안 됨\n");
    assert.deepEqual(await texts(page, "today"), ["잃으면 안 됨"]);
    await context.close();
  });

  await scenario("저장 폴더가 바뀌면 밀린 편집은 새 폴더 파일과 합집합으로 합친다(옛 폴더 기준으로 새 폴더 줄을 지우지 않는다)", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 옛 폴더 것\n" } });
    await page.evaluate(() => window.__setRootAvailable(false));
    await add(page, "내가 적음");
    await page.clock.runFor(100);
    // 기본 폴더에는 다른 내용의 같은 날 파일이 있다(옛 폴더 것 없이)
    await page.evaluate((p) => window.__setFile(p, "- [ ] 새 폴더 것\n"), TODAY);
    await page.locator('.foot [data-action="default-folder"]').click();
    await page.clock.runFor(100);
    await page.waitForSelector(".foot");
    await page.clock.runFor(100);
    assert.equal((await fs(page))[TODAY], "- [ ] 새 폴더 것\n- [ ] 옛 폴더 것\n- [ ] 내가 적음\n");
    await context.close();
  });

  // QA2-09
  await scenario("빠른 입력: '이미 있는 할 일' 안내 뒤 이어서 고쳐 쓰면 창이 닫히지 않고 Enter로 넣을 수 있다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 장보기\n" } });
    const input = page.locator(".quick input");
    await input.fill("장보기");
    await input.press("Enter");
    await page.clock.runFor(200);
    assert.match((await page.locator(".quick").innerText()).trim(), /이미 있는 할 일이에요/);
    await input.press("End");
    await input.pressSequentially(" 우유");
    await page.clock.runFor(100);
    await input.press("Enter");
    await page.clock.runFor(1000);
    assert.equal((await fs(page))[TODAY], "- [ ] 장보기 우유\n- [ ] 장보기\n");
    assert.equal((await calls(page, "hide_quick")).length, 1, "추가한 뒤 한 번만 닫혀야 한다");
    await context.close();
  });

  // QA2-10
  await scenario("체크박스에서 Space로 체크하면 0.5초 뒤 정렬돼도 포커스가 그 체크박스에 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n- [ ] 둘\n- [ ] 셋\n" } });
    await box(page, 0).focus();
    await page.keyboard.press("Space");
    await page.clock.runFor(700);
    const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    assert.equal(label, "하나");
    await context.close();
  });

  await scenario("할 일 칸에서 Cmd+Enter로 체크하면 0.5초 뒤 정렬돼도 커서가 그 칸에 남아 이어서 칠 수 있다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n- [ ] 둘\n- [ ] 셋\n" } });
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.press(CMD_ENTER);
    await page.clock.runFor(700);
    assert.equal(await page.evaluate(() => document.activeElement?.className + "|" + document.activeElement?.textContent), "text|하나");
    await page.keyboard.type("!");
    await page.clock.runFor(1100);
    assert.equal((await fs(page))[TODAY], "- [ ] 둘\n- [ ] 셋\n- [x] 하나!\n");
    await context.close();
  });

  // K05·K08
  await scenario("빈 할 일에서 Cmd+Enter는 아무것도 하지 않는다(저장되지 않는 체크된 빈 칸이 생기지 않음)", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.press(CMD_ENTER);
    await page.clock.runFor(1500);
    assert.equal(await page.locator('[data-list="today"] .item.done').count(), 0);
    await context.close();
  });

  await scenario("'- [x]' 줄이 섞인 여러 줄을 붙여넣으면 끝낸 일은 끝낸 일들 맨 위로 간다(정렬 설정)", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n- [ ] 둘\n- [x] 끝\n" } });
    await text(page, 0).click();
    await caretToEnd(page);
    await paste(text(page, 0), "\n- [x] 붙인 끝\n- [ ] 붙인 남음\n- [x] 붙인 끝2");
    await page.clock.runFor(1500);
    assert.equal(
      (await fs(page))[TODAY],
      "- [ ] 하나\n- [ ] 붙인 남음\n- [ ] 둘\n- [x] 붙인 끝\n- [x] 붙인 끝2\n- [x] 끝\n",
    );
    await context.close();
  });

  // QA2-11
  await scenario("처음 켤 때 입력칸이 막혀 있지 않고 바로 적을 수 있다", async () => {
    const { page, context } = await openApp(browser);
    assert.equal(await page.locator(".add.locked").count(), 0);
    await page.clock.runFor(500);
    await add(page, "바로");
    assert.equal((await fs(page))[TODAY], "- [ ] 바로\n");
    await context.close();
  });

  await scenario("빠른 입력: 처음 켜자마자 적고 Enter를 누르면 넣는다", async () => {
    const { page, context } = await openApp(browser, QUICK);
    await page.locator(".quick input").fill("먼저 적음");
    await page.locator(".quick input").press("Enter");
    await page.clock.runFor(500);
    assert.equal((await fs(page))[TODAY], "- [ ] 먼저 적음\n");
    await context.close();
  });
}
