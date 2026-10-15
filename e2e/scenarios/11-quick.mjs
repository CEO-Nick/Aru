import assert from "node:assert/strict";
import { fs, openApp, scenario, texts } from "../harness.mjs";

const QUICK = { hash: "#quick", viewport: { width: 620, height: 96 } };
const TODAY = "daily/2026-10-14.md";
const calls = (page, name) => page.evaluate((n) => window.__calls.filter(([c]) => c === n).length, name);

export default async function (browser) {
  await scenario("빠른 입력창: 쓰고 Enter → 오늘 할 일 맨 끝에 추가되고(메모 유지) 잠시 뒤 창이 닫힌다", async () => {
    const { page, context, errors } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [x] 하나\n\n메모\n" } });
    assert.ok(await page.locator(".quick input").evaluate((e) => e === document.activeElement), "입력칸에 커서가 없다");
    await page.keyboard.type("전자고지서 배포");
    await page.keyboard.press("Enter");
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [x] 하나\n- [ ] 전자고지서 배포\n\n메모\n");
    assert.equal(await page.locator(".hint").textContent(), "추가됨");
    assert.equal(await calls(page, "hide_quick"), 0);
    await page.clock.runFor(300);
    assert.equal(await calls(page, "hide_quick"), 1);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("Tab으로 '언젠가'로 바꾸면 someday.md에 추가된다", async () => {
    const { page, context } = await openApp(browser, QUICK);
    await page.keyboard.press("Tab");
    assert.equal((await page.locator(".target").textContent()).trim(), "언젠가");
    assert.equal(await page.locator(".quick input").getAttribute("placeholder"), "언젠가 할 일 추가");
    await page.keyboard.type("여권 갱신");
    await page.keyboard.press("Enter");
    await page.clock.runFor(10);
    assert.equal((await fs(page))["someday.md"], "- [ ] 여권 갱신\n");
    await context.close();
  });

  await scenario("Esc나 빈 칸 Enter는 아무것도 저장하지 않고 닫는다", async () => {
    const { page, context } = await openApp(browser, QUICK);
    await page.keyboard.type("안 쓸 일");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await page.clock.runFor(10);
    assert.equal(await calls(page, "hide_quick"), 2);
    assert.equal(await calls(page, "write_text"), 0);
    await context.close();
  });

  await scenario("한글 조합을 확정하는 Enter로는 추가하지 않는다", async () => {
    const { page, context } = await openApp(browser, QUICK);
    await page.keyboard.type("회의");
    await page.locator(".quick input").dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
    await page.clock.runFor(10);
    assert.equal(await calls(page, "write_text"), 0);
    await context.close();
  });

  await scenario("다시 띄우면(quick-shown) 입력칸과 대상이 처음 상태로 돌아온다", async () => {
    const { page, context } = await openApp(browser, QUICK);
    await page.keyboard.press("Tab");
    await page.keyboard.type("남은 글");
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(10);
    assert.equal(await page.locator(".quick input").inputValue(), "");
    assert.equal((await page.locator(".target").textContent()).trim(), "오늘");
    await context.close();
  });

  await scenario("다른 곳을 누르면(창이 포커스를 잃으면) 닫힌다", async () => {
    const { page, context } = await openApp(browser, QUICK);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(10);
    assert.equal(await calls(page, "hide_quick"), 1);
    await context.close();
  });

  await scenario("빠른 입력창이 추가한 할 일이 작은 창에 바로 나타난다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    await page.evaluate((p) => {
      window.__setFile(p, "- [ ] 하나\n- [ ] 빠른 입력으로 추가\n");
      window.__emit("file-changed", { path: p, source: "quick" });
    }, TODAY);
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "today"), ["하나", "빠른 입력으로 추가"]);
    await context.close();
  });
}
