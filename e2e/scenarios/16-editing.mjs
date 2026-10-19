import assert from "node:assert/strict";
import { caretToEnd, fs, openApp, paste, reload, scenario, setCaret, texts } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
const item = (page, n) => page.locator('[data-list="today"] .item .text').nth(n);
const box = (page, n) => page.locator('[data-list="today"] .item .box').nth(n);

export default async function (browser) {
  // UI-06: 하위 줄은 화면에 안 보이므로, 빈 줄 하나 지우는 줄 알고 누른 Backspace가 하위 줄까지 지우면 안 된다
  await scenario("하위 줄이 있는 빈 할 일을 Backspace로 지우면 하위 줄은 위 할 일 밑으로 옮겨 간다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 위\n- [ ] 부모\n  - [ ] 자식 메모\n" } });
    await item(page, 1).click();
    await caretToEnd(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
    await page.clock.runFor(1100);
    assert.deepEqual(await texts(page, "today"), ["위"]);
    assert.equal((await fs(page))[TODAY], "- [ ] 위\n  - [ ] 자식 메모\n");
    await context.close();
  });

  await scenario("하위 줄이 있는 빈 할 일이 맨 위면 Backspace로 지워지지 않는다(하위 줄이 갈 곳이 없다)", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 부모\n  메모 줄\n" } });
    await item(page, 0).click();
    await caretToEnd(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
    await page.clock.runFor(1100);
    assert.equal(await page.locator('[data-list="today"] .item').count(), 1);
    assert.equal((await fs(page))[TODAY], "- [ ] \n  메모 줄\n");
    await context.close();
  });

  // UI-17: 끝낸 일과 남은 일을 합치면 한쪽 상태가 사라진다
  await scenario("끝낸 일 맨 앞 Backspace는 위의 남은 일과 합치지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 남은\n- [x] 끝낸\n" } });
    await item(page, 1).click();
    await setCaret(page, 0);
    await page.keyboard.press("Backspace");
    await page.clock.runFor(1100);
    assert.deepEqual(await texts(page, "today"), ["남은", "끝낸"]);
    assert.equal((await fs(page))[TODAY], "- [ ] 남은\n- [x] 끝낸\n");
    await context.close();
  });

  await scenario("남은 일 맨 앞 Backspace는 위의 끝낸 일과 합치지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [x] 끝낸\n- [ ] 남은\n" } });
    await item(page, 1).click();
    await setCaret(page, 0);
    await page.keyboard.press("Backspace");
    await page.clock.runFor(1100);
    assert.deepEqual(await texts(page, "today"), ["끝낸", "남은"]);
    await context.close();
  });

  // UI-03: 줄바꿈 계열 글자가 할 일에 들어가면 다시 읽을 때 메모로 바뀌어 화면에서 사라진다
  for (const [name, ch] of [
    ["U+2028", "\u2028"],
    ["U+2029", "\u2029"],
  ]) {
    await scenario(`입력칸에 ${name}가 섞인 글을 넣어도 한 줄 할 일로 저장되고 다시 켜도 보인다`, async () => {
      const { page, context } = await openApp(browser);
      const input = page.locator('[data-list="today"] .add input');
      await input.fill(`회의 준비${ch}자료`);
      await input.press("Enter");
      await page.clock.runFor(10);
      assert.equal((await fs(page))[TODAY], "- [ ] 회의 준비 자료\n");
      await reload(page);
      assert.deepEqual(await texts(page, "today"), ["회의 준비 자료"]);
      await context.close();
    });
  }

  await scenario("항목에 CR만 있는 여러 줄을 붙여넣어도 줄마다 할 일이 되고 다시 켜도 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 메모\n" } });
    await item(page, 0).click();
    await caretToEnd(page);
    await paste(item(page, 0), " 첫줄\r둘째줄");
    await page.clock.runFor(1500);
    assert.deepEqual(await texts(page, "today"), ["메모 첫줄", "둘째줄"]);
    await reload(page);
    assert.deepEqual(await texts(page, "today"), ["메모 첫줄", "둘째줄"]);
    await context.close();
  });

  await scenario("항목에 U+2028이 섞인 글을 넣으면 공백으로 바뀌어 저장된다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 기존\n" } });
    await item(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.insertText("x\u2028y");
    await page.clock.runFor(1100);
    assert.equal((await fs(page))[TODAY], "- [ ] 기존x y\n");
    await context.close();
  });

  // UI-12: WebKit 입력칸은 연속·끝 공백을 NBSP로 넣는다
  await scenario("연속 공백·끝 공백을 쳐도 파일에는 일반 공백으로 저장되고 커서가 튀지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" } });
    await item(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("  b  c ");
    await page.keyboard.type("d");
    await page.clock.runFor(1500);
    const file = (await fs(page))[TODAY];
    assert.equal(file, "- [ ] a  b  c d\n");
    await context.close();
  });

  // A12: 다른 편집기에서 복사한 마크다운 목록
  await scenario("마크다운 할 일 목록을 붙여넣으면 '- [ ]' 표기 없이 항목이 되고 체크 상태도 따라온다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 기존\n" } });
    await item(page, 0).click();
    await caretToEnd(page);
    await paste(item(page, 0), "\n- [ ] 우유\n- [x] 빵\n* [X] 잼\n\n");
    await page.clock.runFor(1100);
    assert.deepEqual(await texts(page, "today"), ["기존", "우유", "빵", "잼"]);
    assert.equal((await fs(page))[TODAY], "- [ ] 기존\n- [ ] 우유\n- [x] 빵\n- [x] 잼\n");
    await context.close();
  });

  // UI-13: 키보드만으로 쓸 수 있어야 한다
  await scenario("Cmd+Enter·Ctrl+Enter는 할 일을 나누지 않고 완료를 바꾸며, Alt+Enter는 아무것도 하지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 보고서 쓰기\n" } });
    await item(page, 0).click();
    await setCaret(page, 3);
    await page.keyboard.press("Meta+Enter");
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "today"), ["보고서 쓰기"]);
    assert.equal((await fs(page))[TODAY], "- [x] 보고서 쓰기\n");
    await page.keyboard.press("Control+Enter");
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 보고서 쓰기\n");
    await page.keyboard.press("Alt+Enter");
    await page.clock.runFor(1100);
    assert.deepEqual(await texts(page, "today"), ["보고서 쓰기"]);
    assert.equal((await fs(page))[TODAY], "- [ ] 보고서 쓰기\n");
    await context.close();
  });

  await scenario("입력칸에서 수정키+Enter를 눌러도 빈 할 일이 생기지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 가\n" } });
    const input = page.locator('[data-list="today"] .add input');
    await input.focus();
    for (const key of ["Meta+Enter", "Control+Enter", "Alt+Enter"]) await page.keyboard.press(key);
    await page.clock.runFor(1100);
    assert.deepEqual(await texts(page, "today"), ["가"]);
    await context.close();
  });

  await scenario("체크박스는 Tab으로 갈 수 있는 체크박스이고 Space·Enter로 완료를 바꾼다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 가\n" } });
    const b = box(page, 0);
    assert.equal(await b.getAttribute("role"), "checkbox");
    assert.equal(await b.getAttribute("aria-checked"), "false");
    assert.equal(await b.getAttribute("aria-label"), "가");
    assert.equal(await b.getAttribute("tabindex"), "0");
    await item(page, 0).click();
    await page.keyboard.press("Shift+Tab");
    assert.ok(await b.evaluate((e) => e === document.activeElement), "Shift+Tab으로 체크박스에 가지 않는다");
    await page.keyboard.press("Space");
    await page.clock.runFor(10);
    assert.equal(await b.getAttribute("aria-checked"), "true");
    assert.equal((await fs(page))[TODAY], "- [x] 가\n");
    await page.keyboard.press("Enter");
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 가\n");
    await context.close();
  });

  await scenario("설정의 '자정에 남은 미완료 항목'은 Tab으로 가서 화살표로 고를 수 있다", async () => {
    const { page, context } = await openApp(browser, { files: { "settings.json": '{"carryOver":"keep"}' } });
    await page.locator('[aria-label="설정"]').click();
    const radios = page.locator('[role="radio"]');
    assert.deepEqual(await radios.evaluateAll((els) => els.map((e) => e.tabIndex)), [0, -1, -1]);
    await radios.nth(0).focus();
    await page.keyboard.press("ArrowDown");
    await page.clock.runFor(10);
    assert.equal(await radios.nth(1).getAttribute("aria-checked"), "true");
    assert.ok(await radios.nth(1).evaluate((e) => e === document.activeElement));
    assert.equal(JSON.parse((await fs(page))["settings.json"]).carryOver, "next-day");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.clock.runFor(10);
    assert.equal(await radios.nth(2).getAttribute("aria-checked"), "true");
    await context.close();
  });
}
