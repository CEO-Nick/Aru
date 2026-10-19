// 라운드 3 QA(QA3-01~06)와 2차 코드 리뷰에서 나온 경우들. QA3 시나리오를 그대로 옮기고 리뷰 항목을 더했다
import assert from "node:assert/strict";
import { calls, caretToEnd, fs, openApp, scenario, setCaret, status, texts } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
const YESTERDAY = "daily/2026-10-13.md";
const TOMORROW = "daily/2026-10-15.md";
const J = JSON.stringify;
const QUICK = { hash: "#quick", viewport: { width: 620, height: 96 } };
const CMD_ENTER = process.platform === "darwin" ? "Meta+Enter" : "Control+Enter";
const NOW = Math.floor(new Date("2026-10-14T10:00:00").getTime() / 1000);

const box = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .box`).nth(i);
const text = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .text`).nth(i);
const footText = async (page) => (await page.locator(".foot").textContent()).replace(/\s+/g, " ").trim();
const quickInput = (page) => page.locator(".quick input");
const quickHint = async (page) => (await page.locator(".quick .hint").textContent()).trim();
const hides = async (page) => (await calls(page, "hide_quick")).length;
async function add(page, value, list = "today") {
  const input = page.locator(`[data-list="${list}"] .add input`);
  await input.fill(value);
  await input.press("Enter");
  await page.clock.runFor(10);
}
const active = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const sel = getSelection();
    return { cls: el?.className, text: el?.textContent, offset: sel?.rangeCount ? sel.getRangeAt(0).startOffset : null };
  });

async function storage(browser) {
  await scenario("QA3-01 폴더가 늦게 붙어 자정 정리가 돌 때 지난 날을 보고 있었으면, 옮긴 할 일이 그 화면에서 빠지고 다음 편집으로 되살아나지 않는다", async () => {
    const files = {
      "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-13" }),
      [YESTERDAY]: "- [ ] 어제 미완료\n- [ ] 어제 다른 일\n- [x] 어제 끝냄\n",
      [TODAY]: "- [ ] 오늘 원래\n",
    };
    const { page, context, errors } = await openApp(browser, { files, rootUnavailable: true });
    await page.locator('button[aria-label="이전 날"]').click();
    await page.clock.runFor(50);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(3200);
    await page.clock.runFor(500);
    assert.deepEqual(await texts(page, "today"), ["어제 끝냄"]);
    assert.equal((await fs(page))[YESTERDAY], "- [x] 어제 끝냄\n");
    await box(page, 0).click();
    await page.clock.runFor(1500);
    const f = await fs(page);
    assert.equal(f[YESTERDAY], "- [ ] 어제 끝냄\n");
    assert.equal(
      f[TODAY],
      "- [ ] 오늘 원래\n- [ ] 어제 미완료 <!-- from:2026-10-13 -->\n- [ ] 어제 다른 일 <!-- from:2026-10-13 -->\n",
    );
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("QA3-01 앱을 켠 채 자정이 지났는데 폴더가 없었고, 그 사이 지난 날로 가 있다가 폴더가 돌아와도 같다", async () => {
    const files = {
      "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-14" }),
      [TODAY]: "- [ ] 14일 미완료\n- [x] 14일 끝냄\n",
    };
    const { page, context } = await openApp(browser, { files, now: "2026-10-14T23:59:30" });
    await page.evaluate(() => window.__setRootAvailable(false));
    await page.clock.runFor(61_000);
    // 15일이 됐다. 14일(지난 날)로 돌아가 본다
    await page.locator('button[aria-label="이전 날"]').click();
    await page.clock.runFor(100);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(3200);
    await page.clock.runFor(500);
    assert.deepEqual(await texts(page, "today"), ["14일 끝냄"]);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.clock.runFor(1500);
    const f = await fs(page);
    assert.equal(f[TODAY], "- [x] 14일 끝냄!\n");
    assert.equal(f[TOMORROW], "- [ ] 14일 미완료 <!-- from:2026-10-14 -->\n");
    await context.close();
  });

  await scenario("QA3-02 다른 편집기가 줄 끝을 CRLF로 바꿔 저장하는 동안 글자를 고치고 있었으면, 같은 할 일이 둘이 되지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n- [ ] 운동\n- [ ] 독서\n" } });
    await page.clock.runFor(2400);
    await text(page, 1).click();
    await caretToEnd(page);
    await page.keyboard.type(" 30분");
    await page.evaluate((p) => window.__setFile(p, "- [ ] 장보기\r\n- [ ] 운동\r\n- [ ] 독서\r\n"), TODAY);
    await page.clock.runFor(1500);
    await page.clock.runFor(3200);
    assert.equal((await fs(page))[TODAY], "- [ ] 장보기\r\n- [ ] 운동 30분\r\n- [ ] 독서\r\n");
    assert.deepEqual(await texts(page, "today"), ["장보기", "운동 30분", "독서"]);
    await context.close();
  });

  await scenario("QA3-02 CRLF로 바뀌고 줄이 더해진 직후, 다시 읽기 전에 체크해도 둘이 되지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n- [ ] 운동\n- [ ] 독서\n" } });
    await page.clock.runFor(2400);
    await page.evaluate((p) => window.__setFile(p, "- [ ] 장보기\r\n- [ ] 운동\r\n- [ ] 독서\r\n- [ ] 새 줄\r\n"), TODAY);
    await box(page, 0).click();
    await page.clock.runFor(800);
    await page.clock.runFor(3200);
    const f = (await fs(page))[TODAY];
    assert.equal(f.split("\n").filter((l) => l.includes("장보기")).length, 1, `장보기 중복: ${J(f)}`);
    assert.equal(f.split("\r\n").length, f.split("\n").length, `줄 끝이 섞임: ${J(f)}`);
    await context.close();
  });

  await scenario("QA3-05 폴더 바꾸기(합집합): 두 폴더 모두 같은 제목이 있으면 제목은 맨 위에 하나, 할 일은 그 아래로 모인다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [TODAY]: "# 10월 14일\n- [ ] 옛 폴더 일\n" },
      globals: { __setRootEmits: true, __pickResult: "/Users/me/새폴더" },
    });
    await page.clock.runFor(2400);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type(" 고침");
    await page.evaluate((p) => window.__setFile(p, "# 10월 14일\n- [ ] 새 폴더 일\n"), TODAY);
    const reloaded = page.waitForEvent("load");
    await page.evaluate(() => window.__emit("data-root-changed", { copied: false, reason: "kept" }));
    await page.clock.runFor(500);
    await reloaded;
    await page.waitForSelector(".foot");
    await page.clock.runFor(500);
    assert.equal((await fs(page))[TODAY], "# 10월 14일\n- [ ] 옛 폴더 일 고침\n- [ ] 새 폴더 일\n");
    await context.close();
  });

  await scenario("G01 아주 긴 iCloud 하위 폴더 이름이 가장 작은 창(260px)에서 가로로 넘치지 않고 title에 전체 경로", async () => {
    const long = "/Users/me/Library/Mobile Documents/com~apple~CloudDocs/" + "아주긴폴더이름".repeat(12) + "/할일";
    const { page, context } = await openApp(browser, { viewport: { width: 260, height: 470 } });
    await page.evaluate((p) => sessionStorage.setItem("__rootPath", p), long);
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(50);
    const info = await page.locator(".settings .path").evaluate((e) => ({
      text: e.textContent,
      title: e.title,
      sw: document.querySelector(".settings-body").scrollWidth,
      cw: document.querySelector(".settings-body").clientWidth,
    }));
    assert.ok(info.text.startsWith("iCloud Drive/"));
    assert.equal(info.title, long);
    assert.ok(info.sw <= info.cw, "설정 화면이 가로로 넘친다");
    await context.close();
  });

  await scenario("G02 폴더를 열 수 없는 동안 두 날짜에 적고, 폴더가 돌아오면 두 날 모두 바깥 변경과 합쳐 저장한다", async () => {
    const files = { [TODAY]: "- [ ] 오늘 원래\n", [YESTERDAY]: "- [ ] 어제 원래\n", "settings.json": '{"carryOver":"keep"}' };
    const { page, context } = await openApp(browser, { files, rootUnavailable: true });
    await page.clock.runFor(100);
    await add(page, "오늘 새로");
    await page.locator('button[aria-label="이전 날"]').click();
    await page.clock.runFor(100);
    await add(page, "어제 새로");
    await page.locator('button[aria-label="다음 날"]').click();
    await page.clock.runFor(100);
    await page.evaluate(([t, y]) => {
      window.__setFile(t, "- [ ] 오늘 원래\n- [ ] 다른 기기 오늘\n");
      window.__setFile(y, "- [ ] 어제 원래\n- [ ] 다른 기기 어제\n");
    }, [TODAY, YESTERDAY]);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(3200);
    await page.clock.runFor(1500);
    const f = await fs(page);
    assert.equal(f[TODAY], "- [ ] 오늘 원래\n- [ ] 오늘 새로\n- [ ] 다른 기기 오늘\n");
    assert.equal(f[YESTERDAY], "- [ ] 어제 원래\n- [ ] 어제 새로\n- [ ] 다른 기기 어제\n");
    await context.close();
  });

  await scenario("G03 폴더를 열 수 없는 동안 적으면 창 아래에 그 사실을 계속 알린다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 원래\n" }, rootUnavailable: true });
    await add(page, "폴더 없을 때 적음");
    await page.clock.runFor(1500);
    assert.match(await footText(page), /저장 폴더를 열 수 없어요/);
    await context.close();
  });
}

async function review(browser) {
  await scenario("리뷰 MED: 자정 정리가 동시에 두 번 불려도(창 focus 두 번) 옮긴 할 일은 하나다", async () => {
    const files = {
      "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-13" }),
      [YESTERDAY]: "- [ ] 어제 일\n",
      [TODAY]: "- [ ] 오늘 원래\n",
    };
    // 읽기가 느려야(iCloud 등) 두 정리가 서로 쓰기 전에 같은 지난 할 일을 읽는다
    const { page, context } = await openApp(browser, { files, rootUnavailable: true, globals: { __readDelay: 30 } });
    await page.clock.runFor(500);
    await page.evaluate(() => {
      window.__setRootAvailable(true);
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.clock.runFor(1500);
    const f = await fs(page);
    assert.equal(f[TODAY], "- [ ] 오늘 원래\n- [ ] 어제 일 <!-- from:2026-10-13 -->\n");
    assert.deepEqual(await texts(page, "today"), ["오늘 원래", "어제 일"]);
    await context.close();
  });

  await scenario("리뷰 MED: 할 일을 복사해 폴더를 바꿨으면(copied) 3-way로 합친다 — 방금 지운 할 일이 되살아나지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [TODAY]: "- [ ] 남길 일\n- [ ] 지울 일\n" },
      globals: { __setRootEmits: true },
    });
    await page.clock.runFor(100);
    await text(page, 1).click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.clock.runFor(10);
    const reloaded = page.waitForEvent("load");
    await page.evaluate(() => window.__emit("data-root-changed", { copied: true, reason: "copied" }));
    await page.clock.runFor(100);
    await reloaded;
    await page.waitForSelector(".foot");
    await page.clock.runFor(100);
    assert.equal((await fs(page))[TODAY], "- [ ] 남길 일\n");
    await context.close();
  });

  await scenario("리뷰 MED: 폴더를 열 수 없는 동안 바꾼 설정을 기본 폴더로 되돌리며 쓸 때 settings.json을 줄 단위로 섞지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "settings.json": J({ opacity: 80, alwaysOnTop: true }), [TODAY]: "- [ ] a\n" },
    });
    await page.clock.runFor(100);
    // 설정을 읽은 뒤 폴더가 빠졌다
    await page.evaluate(() => window.__setRootAvailable(false));
    await page.locator('[aria-label="항상 위에 고정"]').click();
    await page.clock.runFor(100);
    await page.evaluate(() => window.__setFile("settings.json", '{\n  "opacity": 40,\n  "alwaysOnTop": true\n}'));
    const reloaded = page.waitForEvent("load");
    await page.locator('[data-action="default-folder"]').click();
    await page.clock.runFor(100);
    await reloaded;
    await page.waitForSelector(".foot");
    await page.clock.runFor(100);
    const saved = (await fs(page))["settings.json"];
    let parsed;
    assert.doesNotThrow(() => (parsed = JSON.parse(saved)), `깨진 JSON: ${J(saved)}`);
    assert.equal(parsed.alwaysOnTop, false);
    await context.close();
  });

  await scenario("리뷰 LOW: 지금 폴더를 열 수 없어 아무것도 옮기지 못하고 바꿨으면 그렇게 알린다(이미 할 일이 있다고 하지 않는다)", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 원래\n" }, globals: { __setRootEmits: true } });
    const reloaded = page.waitForEvent("load");
    await page.evaluate(() => window.__emit("data-root-changed", { copied: false, reason: "sourceUnavailable" }));
    await page.clock.runFor(100);
    await reloaded;
    await page.waitForSelector(".foot");
    await page.clock.runFor(10);
    assert.equal(await status(page), "이전 폴더를 열 수 없어 할 일을 옮기지 못했어요. 이전 폴더가 다시 열리면 그 할 일은 그대로 있어요");
    await context.close();
  });

  await scenario("의심 항목: '옮기지 않았어요' 안내가 떠 있는 10초 동안 폴더를 열 수 없게 되면 그 경고가 가려지지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 원래\n" }, globals: { __setRootEmits: true } });
    const reloaded = page.waitForEvent("load");
    await page.evaluate(() => window.__emit("data-root-changed", { copied: false, reason: "kept" }));
    await page.clock.runFor(100);
    await reloaded;
    await page.waitForSelector(".foot");
    await page.clock.runFor(10);
    assert.match(await status(page), /이미 할 일이 있는 폴더라/);
    await page.evaluate(() => window.__setRootAvailable(false));
    await add(page, "적음");
    await page.clock.runFor(1500);
    assert.equal(await status(page), "저장 폴더를 열 수 없어요");
    await context.close();
  });
}

async function quick(browser) {
  await scenario("QA3-03 저장이 늦는 중 Enter 뒤 창을 다시 불러 새 글을 쓰면, 앞 추가가 끝나도 새 창을 닫지 않고 새 글이 남으며 '추가됨'도 뜨지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      ...QUICK,
      files: { [TODAY]: "- [ ] 원래\n" },
      globals: { __readDelay: 600 },
    });
    await page.keyboard.type("첫 번째");
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(50);
    await page.keyboard.type("두 번째");
    await page.clock.runFor(1100);
    assert.equal(await hides(page), 0, "두 번째 글을 쓰는 중에 창이 닫혔다");
    assert.equal(await quickInput(page).inputValue(), "두 번째");
    assert.equal((await fs(page))[TODAY], "- [ ] 첫 번째\n- [ ] 원래\n");
    assert.equal(await page.locator(".quick.added").count(), 0, "새 창에 '추가됨'이 떴다");
    await context.close();
  });

  await scenario("QA3-03 파일 읽기가 느릴 때(iCloud 등) Enter 뒤 창을 다시 불러 새 글을 쓰면, 앞 추가가 새 창을 닫거나 새 글을 지우지 않는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 500 } });
    await page.keyboard.type("첫 번째");
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(50);
    await page.keyboard.type("두 번째");
    await page.clock.runFor(800);
    assert.equal(await hides(page), 0, "새 글을 쓰는 중에 앞 추가가 창을 닫았다");
    assert.equal(await quickInput(page).inputValue(), "두 번째");
    assert.equal((await fs(page))[TODAY], "- [ ] 첫 번째\n- [ ] 원래\n");
    await context.close();
  });

  // 라운드 4(리뷰 L4)에서 규칙을 바꿨다: 칸 글이 방금 넣은 글로 시작하면 이어 친 부분만 남긴다.
  // 예전처럼 "회의 자료"를 남기면 Enter 한 번에 "회의"를 품은 할 일이 하나 더 생긴다
  await scenario("QA3-03 쓰는 중에 이어 친 글자가 있으면 창을 닫지 않고 이어 친 부분만 남긴다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "" }, globals: { __readDelay: 300 } });
    await page.keyboard.type("회의");
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
    await page.keyboard.type(" 자료");
    await page.clock.runFor(800);
    assert.equal((await fs(page))[TODAY], "- [ ] 회의\n");
    assert.equal(await hides(page), 0);
    assert.equal(await quickInput(page).inputValue(), "자료");
    await context.close();
  });

  await scenario("B03 폴더를 열 수 없어 실패 → 닫힘 → 다시 띄우면 글이 남아 있고, 폴더가 돌아오면 Enter로 들어간다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, rootUnavailable: true });
    await page.keyboard.type("보존될 글");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    assert.equal(await quickHint(page), "저장 폴더를 열 수 없어요");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(50);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(50);
    assert.equal(await quickInput(page).inputValue(), "보존될 글");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    assert.equal((await fs(page))[TODAY], "- [ ] 보존될 글\n- [ ] 원래\n");
    await page.clock.runFor(400);
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(50);
    assert.equal(await quickInput(page).inputValue(), "");
    await context.close();
  });

  await scenario("QA3-06 보이지 않는 글자(폭 0 공백 등)만 쓴 글은 빠른 입력·목록 어디서도 할 일로 넣지 않는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" } });
    for (const value of ["​", "⁠‍", "﻿­", "　"]) {
      await page.evaluate(() => window.__emit("quick-shown"));
      await page.clock.runFor(10);
      await quickInput(page).fill(value);
      await page.keyboard.press("Enter");
      await page.clock.runFor(50);
    }
    assert.equal((await fs(page))[TODAY], "- [ ] 원래\n");
    await context.close();

    const main = await openApp(browser, { files: { [TODAY]: "- [ ] 원래\n" } });
    await add(main.page, "​‌");
    await main.page.clock.runFor(1500);
    assert.deepEqual(await texts(main.page, "today"), ["원래"]);
    assert.equal((await fs(main.page))[TODAY], "- [ ] 원래\n");
    // 이모지 속 ZWJ는 글자다
    await add(main.page, "👨‍👩‍👧 모임");
    await main.page.clock.runFor(1500);
    assert.equal((await fs(main.page))[TODAY], "- [ ] 원래\n- [ ] 👨‍👩‍👧 모임\n");
    await main.context.close();
  });

  await scenario("B05 같은 글 건너뜀 안내 뒤 같은 글로 다시 Enter → 창은 마지막 Enter로부터 0.9초 뒤 닫힌다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 장보기\n" } });
    await page.keyboard.type("장보기");
    await page.keyboard.press("Enter");
    await page.clock.runFor(500);
    await page.keyboard.press("Enter");
    await page.clock.runFor(600);
    assert.equal(await hides(page), 0);
    await page.clock.runFor(400);
    assert.equal(await hides(page), 1);
    await context.close();
  });

  await scenario("B06 2만 자 글도 한 줄로 들어간다", async () => {
    const long = "가".repeat(20000);
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "" } });
    await quickInput(page).fill(long);
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    assert.equal((await fs(page))[TODAY], `- [ ] ${long}\n`);
    await context.close();
  });
}

async function keyboard(browser) {
  await scenario("C01 글자 가운데 커서에서 Cmd+Enter → 정렬 뒤 같은 칸·같은 커서 위치에 이어 친 글자가 들어간다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기 우유\n- [ ] 운동\n- [ ] 독서\n" } });
    await text(page, 0).click();
    await setCaret(page, 3);
    await page.keyboard.press(CMD_ENTER);
    await page.clock.runFor(600);
    assert.equal((await active(page)).text, "장보기 우유");
    await page.keyboard.type("X");
    await page.clock.runFor(1500);
    // 커서 3은 "장보기" 바로 뒤다(QA 기대값 정정)
    assert.equal((await fs(page))[TODAY], "- [ ] 운동\n- [ ] 독서\n- [x] 장보기X 우유\n");
    await context.close();
  });

  await scenario("C02 체크박스에서 Space 두 번(0.5초 안) → 제자리, 포커스 유지, 파일은 원래대로", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n- [ ] b\n" } });
    await box(page, 0).focus();
    await page.keyboard.press("Space");
    await page.clock.runFor(200);
    await page.keyboard.press("Space");
    await page.clock.runFor(800);
    assert.deepEqual(await texts(page, "today"), ["a", "b"]);
    assert.equal((await active(page)).cls, "box");
    assert.equal((await fs(page))[TODAY], "- [ ] a\n- [ ] b\n");
    await context.close();
  });

  await scenario("C03 Cmd+Enter 직후 ArrowDown으로 다른 칸에 가면, 정렬 뒤 포커스가 옮겨 간 칸에 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n- [ ] b\n- [ ] c\n" } });
    await text(page, 0).click();
    await page.keyboard.press(CMD_ENTER);
    await page.clock.runFor(100);
    await page.keyboard.press("ArrowDown");
    await page.clock.runFor(610);
    assert.equal((await active(page)).text, "b");
    await context.close();
  });

  await scenario("C04 끝낸 일에서 Cmd+Enter로 풀면 남은 일 끝으로 가고 포커스가 따라간다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n- [x] b\n- [x] c\n" } });
    await text(page, 2).click();
    await page.keyboard.press(CMD_ENTER);
    await page.clock.runFor(600);
    assert.deepEqual(await texts(page, "today"), ["a", "c", "b"]);
    assert.equal((await active(page)).text, "c");
    await context.close();
  });

  await scenario("C05 Cmd+Enter 연속 두 항목 → 둘 다 끝낸 일로, 마지막 포커스 칸 유지", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n- [ ] b\n- [ ] c\n" } });
    await text(page, 0).click();
    await page.keyboard.press(CMD_ENTER);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press(CMD_ENTER);
    await page.clock.runFor(700);
    assert.equal((await active(page)).text, "b");
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY].split("\n").filter((l) => l.startsWith("- [x]")).length, 2);
    await context.close();
  });

  await scenario("C06 마지막 줄 Enter로 빈 할 일을 만들고 Cmd+Enter → 아무 일 없음, 그 칸에 계속 입력", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.keyboard.press(CMD_ENTER);
    await page.clock.runFor(600);
    await page.keyboard.type("새것");
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] a\n- [ ] 새것\n");
    await context.close();
  });

  await scenario("C07 언젠가 목록에서도 Space 체크 뒤 포커스가 같은 체크박스에 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { "someday.md": "- [ ] 여권\n- [ ] 이사\n" } });
    await box(page, 0, "someday").focus();
    await page.keyboard.press("Space");
    await page.clock.runFor(700);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "여권");
    await context.close();
  });
}

async function ai(browser) {
  await scenario("D01 다른 항목을 고치는 중(저장 전)에 AI가 넣고 되돌리기 → 내 고침은 남고 AI 항목만 빠진다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n## 오후\n- [ ] 회의\n" } });
    await page.clock.runFor(2400);
    await text(page, 1).click();
    await caretToEnd(page);
    await page.keyboard.type(" 3시");
    await page.evaluate(
      ([p, c, b]) => {
        window.__setFile(p, c);
        window.__aiBatches = [b];
        window.__emit("file-changed", { path: p, source: "cli" });
      },
      [TODAY, `- [ ] 기획서 <!-- ai:codex@${NOW + 5} -->\n- [ ] 장보기\n## 오후\n- [ ] 회의\n`, { by: "codex", at: NOW + 5, path: TODAY, count: 1 }],
    );
    await page.clock.runFor(300);
    await page.clock.runFor(3500);
    await page.locator('[data-action="undo-ai"]').click();
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] 장보기\n## 오후\n- [ ] 회의 3시\n");
    await context.close();
  });

  await scenario("D02 보이지 않는 날 되돌리기: 소제목·CRLF·BOM과 그 사이 aru가 넣은 줄은 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    const content = `﻿- [ ] 원래\r\n## 오후\r\n- [ ] 기획서 <!-- ai:codex@${NOW + 5} -->\r\n- [ ] 오후 일\r\n`;
    await page.evaluate(
      ([p, c, b]) => {
        window.__setFile(p, c);
        window.__aiBatches = [b];
      },
      [TOMORROW, content, { by: "codex", at: NOW + 5, path: TOMORROW, count: 1 }],
    );
    await page.clock.runFor(3500);
    await page.evaluate(([p, c]) => (window.__interleave = { [p]: c }), [TOMORROW, content.replace("- [ ] 오후 일\r\n", "- [ ] 오후 일\r\n- [ ] aru 추가\r\n")]);
    await page.locator('[data-action="undo-ai"]').click();
    await page.clock.runFor(50);
    assert.equal((await fs(page))[TOMORROW], "﻿- [ ] 원래\r\n## 오후\r\n- [ ] 오후 일\r\n- [ ] aru 추가\r\n");
    await context.close();
  });

  await scenario("QA3-04 AI 항목 밑에 사용자가 단 하위 줄이 있으면 되돌려도 항목과 하위 줄을 남기고 AI 표시만 뗀다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    await page.evaluate(
      ([p, c, b]) => {
        window.__setFile(p, c);
        window.__aiBatches = [b];
      },
      [
        TODAY,
        `- [ ] 기획서 <!-- ai:codex@${NOW + 5} -->\n  - 내가 단 메모\n- [ ] 회의 <!-- ai:codex@${NOW + 5} -->\n- [ ] 장보기\n`,
        { by: "codex", at: NOW + 5, path: TODAY, count: 2 },
      ],
    );
    await page.clock.runFor(3500);
    await page.locator('[data-action="undo-ai"]').click();
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] 기획서\n  - 내가 단 메모\n- [ ] 장보기\n");
    assert.equal(await page.locator('[data-action="undo-ai"]').count(), 0);
    await context.close();
  });

  await scenario("QA3-04 보이지 않는 날의 되돌리기도 하위 줄이 있는 항목은 남긴다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    await page.evaluate(
      ([p, c, b]) => {
        window.__setFile(p, c);
        window.__aiBatches = [b];
      },
      [TOMORROW, `- [ ] 기획서 <!-- ai:codex@${NOW + 5} -->\n  - 메모\n- [ ] 회의 <!-- ai:codex@${NOW + 5} -->\n`, { by: "codex", at: NOW + 5, path: TOMORROW, count: 2 }],
    );
    await page.clock.runFor(3500);
    await page.locator('[data-action="undo-ai"]').click();
    await page.clock.runFor(50);
    assert.equal((await fs(page))[TOMORROW], "- [ ] 기획서\n  - 메모\n");
    await context.close();
  });
}

function bigFile(n) {
  const lines = [];
  for (let i = 0; i < n; i++) {
    if (i % 20 === 0) lines.push(`## 구역 ${i}`);
    lines.push(`- [${i % 3 === 0 ? "x" : " "}] 할 일 ${i}`);
  }
  lines.push("", "메모", "```", "- [ ] 예시", "```");
  return lines.join("\r\n") + "\r\n";
}

async function perf(browser) {
  for (const n of [1000, 5000]) {
    await scenario(`E01 ${n}개(소제목·메모·CRLF): 글자 입력이 빠르고, 바깥 변경과 합쳐도 줄 끝이 섞이지 않는다`, async () => {
      const { page, context } = await openApp(browser, { files: { [TODAY]: bigFile(n) } });
      await text(page, 1).click();
      await caretToEnd(page);
      const t1 = Date.now();
      await page.keyboard.type("abcde");
      const perChar = (Date.now() - t1) / 5;
      await page.clock.runFor(1200);
      const f1 = (await fs(page))[TODAY];
      await page.keyboard.type("Z");
      await page.evaluate(([p, c]) => window.__setFile(p, c), [TODAY, "- [ ] aru 추가\r\n" + f1]);
      await page.clock.runFor(3100);
      await page.clock.runFor(1500);
      const f2 = (await fs(page))[TODAY];
      await box(page, 2).click();
      await page.clock.runFor(800);
      const f3 = (await fs(page))[TODAY];
      assert.ok(f2.startsWith("- [ ] aru 추가\r\n"), "aru 추가 줄이 맨 위에 없음");
      assert.ok(f2.includes("할 일 1abcdeZ"), "내 고침 누락");
      assert.equal(f2.split("\r\n").length, f2.split("\n").length, "줄 끝이 섞임");
      assert.equal(f3.split("\n").length, f2.split("\n").length, "체크 뒤 줄 수가 바뀜");
      assert.ok(perChar < 150, `글자당 ${perChar}ms`);
      await context.close();
    });
  }
}

async function rollover(browser) {
  await scenario("H01 내일 화면을 보는 중 자정이 지나면, 어제 미완료가 그 목록에 들어오고 파일·화면이 같다", async () => {
    const files = {
      "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-14" }),
      [TODAY]: "- [ ] 오늘 미완료\n- [x] 끝냄\n",
      [TOMORROW]: "- [ ] 내일 원래\n",
    };
    const { page, context } = await openApp(browser, { files, now: "2026-10-14T23:59:30" });
    await page.locator('button[aria-label="다음 날"]').click();
    await page.clock.runFor(100);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type(" 고침");
    await page.clock.runFor(61_000);
    await page.clock.runFor(1500);
    const f = await fs(page);
    assert.deepEqual(await texts(page, "today"), ["내일 원래 고침", "오늘 미완료"]);
    assert.equal(f[TOMORROW], "- [ ] 내일 원래 고침\n- [ ] 오늘 미완료 <!-- from:2026-10-14 -->\n");
    assert.equal(f[TODAY], "- [x] 끝냄\n");
    await context.close();
  });

  await scenario("H02 체크 직후(정렬 대기 안) 자정이 지나도 체크가 저장되고 새 날 화면이 맞다", async () => {
    const files = { "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-14" }), [TODAY]: "- [ ] a\n- [ ] b\n" };
    const { page, context } = await openApp(browser, { files, now: "2026-10-14T23:59:59" });
    await page.clock.runFor(500);
    await box(page, 0).click();
    await page.clock.runFor(61_000);
    await page.clock.runFor(1500);
    const f = await fs(page);
    assert.equal(f[TODAY], "- [x] a\n");
    assert.equal(f[TOMORROW], "- [ ] b <!-- from:2026-10-14 -->\n");
    assert.deepEqual(await texts(page, "today"), ["b"]);
    await context.close();
  });

  await scenario("H03 '언젠가로' 설정에서 언젠가를 고치는 중 자정 → 고침과 옮겨 온 일 모두 언젠가 파일에", async () => {
    const files = {
      "settings.json": J({ carryOver: "someday", lastRolloverDate: "2026-10-14" }),
      [TODAY]: "- [ ] 오늘 미완료\n",
      "someday.md": "- [ ] 여권\n",
    };
    const { page, context } = await openApp(browser, { files, now: "2026-10-14T23:59:30" });
    await text(page, 0, "someday").click();
    await caretToEnd(page);
    await page.keyboard.type(" 갱신");
    await page.clock.runFor(61_000);
    await page.clock.runFor(1500);
    const f = await fs(page);
    assert.equal(f["someday.md"], "- [ ] 여권 갱신\n- [ ] 오늘 미완료 <!-- from:2026-10-14 -->\n");
    assert.ok(!(f[TODAY] ?? "").includes("오늘 미완료"));
    await context.close();
  });
}

export default async function (browser) {
  await storage(browser);
  await review(browser);
  await quick(browser);
  await keyboard(browser);
  await ai(browser);
  await perf(browser);
  await rollover(browser);
}
