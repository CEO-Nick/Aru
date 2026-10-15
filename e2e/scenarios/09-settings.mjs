import assert from "node:assert/strict";
import { fs, openApp, scenario, texts, caretToEnd } from "../harness.mjs";

const calls = (page, name) =>
  page.evaluate((n) => window.__calls.filter(([c]) => c === n).map(([, a]) => a), name);

export default async function (browser) {
  await scenario("톱니를 누르면 설정이 열리고, 저장 폴더가 보이며, 완료를 누르면 목록으로 돌아간다", async () => {
    const { page, context, errors } = await openApp(browser, { files: { "daily/2026-10-14.md": "- [ ] 하나\n" } });
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(10);
    assert.equal(await page.locator(".settings .path").textContent(), "/Users/me/Library/Application Support/dev.aruu.floatingtodo");
    assert.equal(await page.locator('[data-list="today"]').isVisible(), false);
    await page.locator('[data-action="close"]').click();
    assert.deepEqual(await texts(page, "today"), ["하나"]);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("미완료 처리를 '다음 날로'로 바꾸면 저장되고, 그날 자정에 바로 적용된다", async () => {
    const { page, context } = await openApp(browser, {
      now: "2026-10-14T23:58:00",
      files: { "daily/2026-10-14.md": "- [ ] PR 리뷰\n" },
    });
    await page.locator('[aria-label="설정"]').click();
    await page.locator(".radio", { hasText: "다음 날로 옮기기" }).click();
    await page.clock.runFor(1100);
    assert.equal(JSON.parse((await fs(page))["settings.json"]).carryOver, "next-day");
    await page.locator('[data-action="close"]').click();
    await page.clock.runFor(150_000);
    assert.deepEqual(await texts(page, "today"), ["PR 리뷰"]);
    assert.equal(await page.locator(".datebar .date").textContent(), "10월 15일 (목)");
    await context.close();
  });

  await scenario("폴더 변경: 고른 폴더로 바꾸기 전에 기다리던 저장부터 쓴다, 취소하면 아무것도 안 바뀐다", async () => {
    const { page, context } = await openApp(browser, { files: { "daily/2026-10-14.md": "- [ ] 하나\n" } });
    await page.locator('[data-list="today"] .item .text').click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.locator('[aria-label="설정"]').click();

    await page.locator('[data-action="change-folder"]').click();
    await page.clock.runFor(10);
    assert.deepEqual(await calls(page, "set_data_root"), []);

    await page.evaluate(() => (window.__pickResult = "/Users/me/Dropbox/todo"));
    await page.locator('[data-action="change-folder"]').click();
    await page.clock.runFor(10);
    assert.deepEqual(await calls(page, "set_data_root"), [{ path: "/Users/me/Dropbox/todo" }]);
    const order = await page.evaluate(() => window.__calls.map(([c]) => c));
    assert.ok(order.lastIndexOf("write_text") < order.indexOf("set_data_root"), "저장 전에 폴더를 바꿨다");
    assert.equal((await fs(page))["daily/2026-10-14.md"], "- [ ] 하나!\n");
    await context.close();
  });

  await scenario("Finder에서 열기", async () => {
    const { page, context } = await openApp(browser);
    await page.locator('[aria-label="설정"]').click();
    await page.locator('[data-action="reveal-folder"]').click();
    await page.clock.runFor(10);
    const revealed = await calls(page, "plugin:opener|reveal_item_in_dir");
    assert.equal(revealed.length, 1);
    await context.close();
  });
}
