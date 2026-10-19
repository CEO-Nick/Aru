// 라운드 5 QA(QA5-01~07, 의심 H3·C1)와 4차 코드 리뷰(N1·N2·N4·N5·N6·Q1)에서 나온 경우들. QA5 시나리오를 옮기고 리뷰 항목을 더했다.
// 응답 없는 쓰기(__hangWrites, __releaseWrites로 풀기)·응답만 늦은 쓰기(__respDelay)는 모의 백엔드에 있다
import assert from "node:assert/strict";
import { calls, caretToEnd, fs, openApp, scenario, setCaret, status, texts } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
const TOMORROW = "daily/2026-10-15.md";
const J = JSON.stringify;
const QUICK = { hash: "#quick", viewport: { width: 620, height: 96 } };
const SLOW = "저장이 늦어지고 있어요…";
const SELECT_ALL = process.platform === "darwin" ? "Meta+A" : "Control+A";

const box = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .box`).nth(i);
const text = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .text`).nth(i);
const quickInput = (page) => page.locator(".quick input");
const quickHint = async (page) => (await page.locator(".quick .hint").textContent()).trim();
const placeholder = (page) => quickInput(page).getAttribute("placeholder");
const lines = (s) => (s ?? "").split("\n").filter(Boolean);
async function typeAtEnd(page, i, s, list = "today") {
  await text(page, i, list).click();
  await caretToEnd(page);
  await page.keyboard.type(s);
}
const nextDay = (page) => page.locator('button[aria-label="다음 날"]').click();

/** 빠른 입력: "첫 번째"를 넣는 중 창을 다시 띄워 "두 번째"를 넣고, 둘 다 저장에 실패한 상태로 만든다 */
async function bothFailed(page) {
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
}

export default async function (browser) {
  // ── QA5-01·리뷰 N1: flush 대기 상한은 전체 하나 ──
  await scenario("QA5-01 응답 없는 쓰기: 오늘·언젠가를 고치고 ▶를 누르면 파일 수와 상관없이 10초 안팎에 넘어간다", async () => {
    const files = { [TODAY]: "- [ ] 오늘\n", [TOMORROW]: "- [ ] 내일\n", "someday.md": "- [ ] 언젠가\n" };
    const { page, context } = await openApp(browser, { files });
    await page.clock.runFor(2400);
    await page.evaluate(() => (window.__hangWrites = true));
    await typeAtEnd(page, 0, "!");
    await typeAtEnd(page, 0, "?", "someday");
    await nextDay(page);
    await page.clock.runFor(9000);
    assert.notDeepEqual(await texts(page, "today"), ["내일"], "아직 기다려야 할 때 넘어감");
    await page.clock.runFor(1500);
    assert.deepEqual(await texts(page, "today"), ["내일"], "10초가 지나도 넘어가지 않음(파일마다 10초)");
    assert.equal(await status(page), SLOW);
    await context.close();
  });

  await scenario("QA5-01 응답 없는 쓰기가 여러 파일에 걸려 있어도 창 닫기는 10초 안팎에 숨는다", async () => {
    const files = { [TODAY]: "- [ ] 오늘\n", "someday.md": "- [ ] 언젠가\n" };
    const { page, context } = await openApp(browser, { files });
    await page.clock.runFor(2400);
    await page.evaluate(() => (window.__hangWrites = true));
    await typeAtEnd(page, 0, "!");
    await typeAtEnd(page, 0, "?", "someday");
    await page.clock.runFor(1100);
    await page.locator('input[type="range"]').fill("30");
    await page.evaluate(() => window.__emit("tauri://close-requested", {}));
    await page.clock.runFor(9000);
    assert.equal((await calls(page, "plugin:window|hide")).length, 0, "아직 기다려야 할 때 숨음");
    await page.clock.runFor(1500);
    assert.equal((await calls(page, "plugin:window|hide")).length, 1, "10초가 지나도 창이 숨지 않음");
    await context.close();
  });

  // ── QA5-02·리뷰 N6: 상한을 넘긴 쓰기 ──
  await scenario("QA5-02 응답 없는 쓰기로 '늦어짐'이 뜬 뒤 더 고쳐도 '저장 대기 중'으로 가리지 않고, 쓰기가 풀리면 가장 새 내용을 쓴다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n" } });
    await page.clock.runFor(2400);
    await page.evaluate(() => (window.__hangWrites = true));
    await typeAtEnd(page, 0, "!");
    await page.clock.runFor(1100);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(10_100);
    assert.equal(await status(page), SLOW);
    await page.keyboard.type("2");
    await page.clock.runFor(60_000);
    assert.equal(await status(page), SLOW, "막힌 저장 뒤에 줄 선 편집이 '저장 대기 중'으로만 보임");
    await page.evaluate(() => window.__releaseWrites());
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] 오늘!2\n");
    assert.equal(await status(page), "저장됨");
    await context.close();
  });

  await scenario("리뷰 N6 10초 넘게 걸리지만 결국 끝나는 느린 쓰기에 '저장 실패'를 띄우지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n" }, globals: { __writeDelay: 12_000 } });
    await page.clock.runFor(2400);
    await typeAtEnd(page, 0, "!");
    await page.clock.runFor(1100);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const seen = new Set();
    for (let t = 0; t < 14_000; t += 500) {
      await page.clock.runFor(500);
      seen.add(await status(page));
    }
    assert.ok(!seen.has("저장 실패 — 다시 시도합니다"), "거짓 저장 실패: " + J([...seen]));
    assert.equal(await status(page), "저장됨");
    assert.equal((await fs(page))[TODAY], "- [ ] 오늘!\n");
    await context.close();
  });

  // ── QA5 H3: 날짜를 바꾸는 동안 ──
  await scenario("H3 느린 폴더에서 ▶ 직후, 새 날을 다 읽기 전에는 이전 날 목록에 적을 수 없고 다 읽으면 새 날에 적힌다", async () => {
    const files = { [TODAY]: "- [ ] 오늘\n", [TOMORROW]: "- [ ] 내일\n" };
    const { page, context } = await openApp(browser, { files, globals: { __writeDelay: 3000 } });
    await page.clock.runFor(2400);
    await typeAtEnd(page, 0, "!");
    await nextDay(page);
    await page.clock.runFor(200);
    assert.deepEqual(await texts(page, "today"), [], "머리는 15일인데 14일 목록이 보임");
    assert.equal(await page.locator('[data-list="today"] .add input').count(), 0, "바꾸는 중에 입력칸이 열려 있음");
    await page.clock.runFor(4000);
    assert.deepEqual(await texts(page, "today"), ["내일"]);
    const input = page.locator('[data-list="today"] .add input');
    await input.fill("내일 회의 준비");
    await input.press("Enter");
    await page.clock.runFor(4000);
    const f = await fs(page);
    assert.ok(f[TOMORROW].includes("내일 회의 준비"));
    assert.equal(f[TODAY], "- [ ] 오늘!\n");
    await context.close();
  });

  // ── QA5 C1: 응답이 오기 전 이미 들어간 내 쓰기 ──
  await scenario("C1 내 쓰기가 파일에 들어간 뒤 응답 전, aru가 한 줄 넣고 내가 더 쳐도 같은 할 일의 옛 글이 따로 남지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n- [ ] b\n" }, globals: { __respDelay: 600 } });
    await page.clock.runFor(2400);
    await typeAtEnd(page, 0, "1");
    await page.clock.runFor(1050);
    assert.equal((await fs(page))[TODAY], "- [ ] a1\n- [ ] b\n");
    await page.keyboard.type("2");
    await page.evaluate((p) => {
      window.__setFile(p, "- [ ] aru 줄 <!-- ai:claude@1792000000 -->\n" + window.__mockFs[p]);
      window.__emit("file-changed", { path: p, source: "cli" });
    }, TODAY);
    await page.clock.runFor(8000);
    const f = (await fs(page))[TODAY];
    assert.ok(f.includes("aru 줄"), "aru 줄이 사라짐: " + J(f));
    assert.ok(!lines(f).includes("- [ ] a1"), "옛 글(a1)이 따로 남음: " + J(f));
    assert.ok(lines(f).includes("- [ ] a12"), J(f));
    assert.deepEqual(await texts(page, "today"), ["aru 줄", "a12", "b"]);
    await context.close();
  });

  // ── QA5-03·리뷰 N5: 이어 친 글만 잘라 낸다 ──
  await scenario("QA5-03 '회의' Enter 후 저장 중 칸을 지우고 '회의록 정리'를 새로 치면 그 글이 그대로 남는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400 } });
    await page.keyboard.type("회의");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.keyboard.press(SELECT_ALL);
    await page.keyboard.press("Backspace");
    await page.keyboard.type("회의록 정리");
    await page.clock.runFor(600);
    assert.equal(await quickInput(page).inputValue(), "회의록 정리");
    assert.equal((await fs(page))[TODAY], "- [ ] 회의\n- [ ] 원래\n");
    await context.close();
  });

  await scenario("리뷰 N5 '우유' Enter 후 저장 중 전체를 골라 '우유빵 사기'를 붙여 넣어도 앞부분이 잘리지 않는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400 } });
    await page.keyboard.type("우유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.keyboard.press(SELECT_ALL);
    await page.keyboard.insertText("우유빵 사기");
    await page.clock.runFor(600);
    assert.equal(await quickInput(page).inputValue(), "우유빵 사기");
    await context.close();
  });

  await scenario("QA5-03 끝에 이어 친 글은 여전히 이어 친 부분만 남긴다(리뷰 L4)", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400 } });
    await page.keyboard.type("우유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.keyboard.type(" 빵");
    await page.clock.runFor(600);
    assert.equal(await quickInput(page).inputValue(), "빵");
    await context.close();
  });

  // ── QA5-04·리뷰 N4: 들고 있던 앞 글 ──
  await scenario("QA5-04 앞 글·지금 글 모두 실패 후 칸을 비우고 Esc로 닫았다 다시 띄우면 앞 글이 대상과 함께 칸에 돌아온다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400 } });
    await bothFailed(page);
    assert.match(await quickHint(page), /앞 글도 남아 있어요/);
    await quickInput(page).fill("");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(50);
    assert.equal(await quickInput(page).inputValue(), "첫 번째");
    assert.equal(await quickHint(page), "앞서 넣으려던 글을 저장하지 못했어요");
    await page.keyboard.press("Enter");
    await page.clock.runFor(800);
    assert.ok((await fs(page))[TODAY].includes("- [ ] 첫 번째\n"));
    await context.close();
  });

  await scenario("QA5-04 그 상태에서 빈 칸에 Enter를 누르면 닫지 않고 앞 글을 칸에 되돌린다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400 } });
    await bothFailed(page);
    await quickInput(page).fill("");
    const hidden = (await calls(page, "hide_quick")).length;
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    assert.equal(await quickInput(page).inputValue(), "첫 번째");
    assert.equal((await calls(page, "hide_quick")).length, hidden, "앞 글을 둔 채 닫음");
    await context.close();
  });

  await scenario("QA5-04 언젠가로 실패한 글을 지우고 닫은 뒤 다시 띄우면 대상이 '오늘'로 돌아온다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, rootUnavailable: true });
    await page.keyboard.type("나중");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await quickInput(page).fill("");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(50);
    assert.equal(await placeholder(page), "오늘 할 일 추가");
    await page.keyboard.type("오늘 일");
    await page.keyboard.press("Enter");
    await page.clock.runFor(400);
    const f = await fs(page);
    assert.ok(f[TODAY].includes("오늘 일"));
    assert.equal(f["someday.md"], undefined);
    await context.close();
  });

  await scenario("QA5-04 실패한 글이 칸에 남아 있으면 다시 띄워도 글과 대상(언젠가)을 그대로 둔다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, rootUnavailable: true });
    await page.keyboard.type("나중");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(50);
    assert.equal(await quickInput(page).inputValue(), "나중");
    assert.equal(await placeholder(page), "언젠가 할 일 추가");
    await context.close();
  });

  // ── QA5-05: 실패한 글과 이어 친 글을 붙이지 않는다 ──
  await scenario("QA5-05 '우유' Enter 후 저장 중 '빵'을 이어 치고 저장이 실패하면 둘을 붙이지 않고 따로 넣는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400, __failWrites: true } });
    await page.keyboard.type("우유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.keyboard.type("빵");
    await page.clock.runFor(600);
    assert.equal(await quickInput(page).inputValue(), "빵");
    assert.match(await quickHint(page), /우유/);
    await page.evaluate(() => (window.__failWrites = false));
    await page.keyboard.press("Enter");
    await page.clock.runFor(800);
    assert.equal(await quickInput(page).inputValue(), "우유", "실패한 앞 글이 칸에 돌아오지 않음");
    await page.keyboard.press("Enter");
    await page.clock.runFor(800);
    const f = (await fs(page))[TODAY];
    assert.ok(!f.includes("우유빵"), "두 할 일이 '우유빵' 하나로 들어감");
    assert.deepEqual(lines(f), ["- [ ] 우유", "- [ ] 빵", "- [ ] 원래"]);
    await context.close();
  });

  // ── QA5-06·07: 보이지 않는 글자만 있는 할 일 ──
  await scenario("QA5-06 다른 편집기가 쓴 '- [x] ㅤ'·'- [ ] ⠀' 줄은 다른 할 일을 체크해도 파일에서 지워지지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n- [x] ㅤ\n- [ ] ⠀\n- [ ] b\n" } });
    await page.clock.runFor(2400);
    await box(page, 0).click();
    await page.clock.runFor(1500);
    const f = (await fs(page))[TODAY];
    assert.ok(f.includes("- [x] ㅤ\n") && f.includes("- [ ] ⠀\n"), "건드리지 않은 줄이 사라짐: " + J(f));
    assert.ok(f.includes("- [x] a\n"));
    await context.close();
  });

  await scenario("QA5-06 앱에서 지워 빈 칸으로 만든 할 일은 여전히 파일에 쓰지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n- [ ] b\n" } });
    await page.clock.runFor(2400);
    await text(page, 0).click();
    await page.evaluate(() => {
      const el = document.activeElement;
      el.textContent = "​";
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] b\n");
    await context.close();
  });

  await scenario("QA5-07 빈 칸처럼 보이는(보이지 않는 글자만 있는) 할 일 아래를 맨 앞 Backspace로 합치면 앞에 아무것도 붙지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 위\n- [ ] 다음\n" } });
    await page.clock.runFor(2400);
    await text(page, 0).click();
    await page.evaluate(() => {
      const el = document.activeElement;
      el.textContent = "​";
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await page.clock.runFor(50);
    await text(page, 1).click();
    await setCaret(page, 0);
    await page.keyboard.press("Backspace");
    await page.clock.runFor(1500);
    assert.deepEqual(await texts(page, "today"), ["다음"]);
    assert.equal((await fs(page))[TODAY], "- [ ] 다음\n");
    await context.close();
  });

  // ── 리뷰 N2: 할 일을 옮기지 않은 폴더 바꾸기 ──
  await scenario("리뷰 N2 할 일을 옮기지 않고 폴더를 바꾸면 기다리던 설정 저장을 버려 새 폴더의 settings.json을 덮지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘\n", "settings.json": J({ allowExternalAdd: true }) } });
    await page.clock.runFor(2400);
    await page.locator('input[type="range"]').fill("30");
    const theirs = J({ allowExternalAdd: false, opacity: 80 });
    const reloaded = page.waitForEvent("load");
    await page.evaluate((s) => {
      // 새 폴더(이미 할 일이 있던 폴더)의 설정이라고 본다. 모의 백엔드는 폴더가 하나라 같은 자리에 둔다
      window.__setFile("settings.json", s);
      sessionStorage.setItem("__rootPath", "/Users/me/Dropbox/todo");
      window.__emit("data-root-changed", { copied: false, reason: "kept" });
    }, theirs);
    await page.clock.runFor(50);
    await reloaded;
    await page.waitForSelector(".foot");
    await page.clock.runFor(1500);
    assert.equal(JSON.parse((await fs(page))["settings.json"]).allowExternalAdd, false, "새 폴더 설정을 이 창 설정으로 덮음");
    await context.close();
  });

  // ── 기타 ──
  await scenario("AboutSection 버전을 읽지 못해도 처리되지 않은 오류 없이 설정 화면이 열린다", async () => {
    const { page, context, errors } = await openApp(browser, { globals: { __failVersion: true } });
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(50);
    assert.equal((await page.locator(".about .version").textContent()).trim(), "Aru");
    assert.deepEqual(errors, []);
    await context.close();
  });
}
