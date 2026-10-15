import assert from "node:assert/strict";
import { openApp, scenario } from "../harness.mjs";

const calls = (page, name) =>
  page.evaluate((n) => window.__calls.filter(([c]) => c === n).map(([, a]) => a), name);

export default async function (browser) {
  await scenario("새 버전이 없으면 업데이트 버튼이 보이지 않는다", async () => {
    const { page, context, errors } = await openApp(browser);
    assert.equal(await page.locator('[data-action="update"]').count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("앱이 켜지기 전에 찾아 둔 새 버전도 창이 열리면 바로 보인다", async () => {
    const { page, context } = await openApp(browser, { pendingUpdate: "0.2.0" });
    assert.equal(await page.locator('[data-action="update"]').textContent(), "0.2.0 업데이트");
    await context.close();
  });

  await scenario("켜져 있는 동안 새 버전을 찾으면 저장 표시 옆에 업데이트 버튼이 뜬다", async () => {
    const { page, context } = await openApp(browser);
    await page.evaluate(() => window.__emit("update-available", "0.3.0"));
    await page.clock.runFor(10);
    assert.equal(await page.locator('.foot [data-action="update"]').textContent(), "0.3.0 업데이트");
    await context.close();
  });

  await scenario("업데이트를 누르면 설치를 요청하고, 받는 동안은 다시 누를 수 없다", async () => {
    const { page, context } = await openApp(browser, { pendingUpdate: "0.2.0" });
    await page.evaluate(() => (window.__installDelay = 5000));
    const button = page.locator('[data-action="update"]');
    await button.click();
    await page.clock.runFor(10);
    assert.equal(await button.textContent(), "받는 중…");
    assert.equal(await button.isDisabled(), true);
    await button.click({ force: true });
    await page.clock.runFor(10);
    assert.equal((await calls(page, "install_update")).length, 1);
    await context.close();
  });

  await scenario("설치에 실패하면 실패를 알리고 다시 누를 수 있다", async () => {
    const { page, context, errors } = await openApp(browser, { pendingUpdate: "0.2.0" });
    await page.evaluate(() => (window.__failInstall = true));
    const button = page.locator('[data-action="update"]');
    await button.click();
    await page.clock.runFor(10);
    assert.equal(await button.textContent(), "업데이트 실패 — 다시 시도");
    assert.equal(await button.isDisabled(), false);
    assert.ok(errors.every((e) => !e.includes("Uncaught")), errors.join("\n"));
    await context.close();
  });
}
