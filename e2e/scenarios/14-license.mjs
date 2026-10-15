import assert from "node:assert/strict";
import { fs, openApp, scenario, texts } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
const BUY = "https://aruu.dev/aru/buy/";
const calls = (page, name) =>
  page.evaluate((n) => window.__calls.filter(([c]) => c === n).map(([, a]) => a), name);
const openSettings = async (page) => {
  await page.locator('[aria-label="설정"]').click();
  await page.clock.runFor(10);
};

export default async function (browser) {
  await scenario("판매 전(꺼짐)에는 라이선스 화면도 체험 표시도 없고 지금처럼 쓴다", async () => {
    const { page, context, errors } = await openApp(browser);
    assert.equal(await page.locator(".locked").count(), 0);
    assert.equal(await page.locator(".foot .trial").count(), 0);
    await openSettings(page);
    assert.equal(await page.locator(".license").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("체험 중에는 설정에 남은 날이 보이고, 3일 이하로 남으면 창 아래에도 조용히 보인다", async () => {
    const five = await openApp(browser, { license: { state: "trial", daysLeft: 5 } });
    assert.equal(await five.page.locator(".foot .trial").count(), 0);
    await openSettings(five.page);
    assert.equal(await five.page.locator(".license .state").textContent(), "체험 5일 남음");
    await five.context.close();

    const two = await openApp(browser, { license: { state: "trial", daysLeft: 2 } });
    assert.equal(await two.page.locator(".foot .trial").textContent(), "체험 2일 남음");
    await two.context.close();
  });

  await scenario("체험이 끝나면 새로 적기만 막고, 적어 둔 할 일은 보이고 체크도 된다", async () => {
    const { page, context } = await openApp(browser, {
      license: { state: "expired" },
      files: { [TODAY]: "- [ ] 하나\n" },
    });
    assert.equal(await page.locator('[data-list="today"] .add input').count(), 0);
    assert.equal(await page.locator('[data-list="today"] .locked .msg').textContent(), "체험이 끝났어요");
    assert.deepEqual(await texts(page, "today"), ["하나"]);
    await page.locator('[data-list="today"] .item .box').click();
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [x] 하나\n");
    await page.locator('[data-list="today"] .locked [data-action="buy"]').click();
    await page.clock.runFor(10);
    assert.equal((await calls(page, "plugin:opener|open_url"))[0].url, BUY);
    await context.close();
  });

  await scenario("체험이 끝나면 할 일 중간에서 Enter로 새 할 일을 만들 수도 없다", async () => {
    const { page, context } = await openApp(browser, {
      license: { state: "expired" },
      files: { [TODAY]: "- [ ] 하나둘\n" },
    });
    await page.locator('[data-list="today"] .item .text').click();
    await page.keyboard.press("Enter");
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "today"), ["하나둘"]);
    await context.close();
  });

  await scenario("설정에서 틀린 키는 알려 주고, 맞는 키를 넣으면 등록되고 다시 적을 수 있다", async () => {
    const { page, context } = await openApp(browser, { license: { state: "expired" } });
    await openSettings(page);
    const input = page.locator(".license input");
    await input.fill("ARU-wrong");
    await page.locator('.license [data-action="activate"]').click();
    await page.clock.runFor(10);
    assert.equal(await page.locator(".license .error").textContent(), "라이선스 키가 올바르지 않아요");
    await input.fill("ARU-valid");
    await page.locator('.license [data-action="activate"]').click();
    await page.clock.runFor(10);
    assert.equal(await page.locator(".license .state").textContent(), "등록됨 · andantej@example.com");
    assert.equal(await page.locator(".license input").count(), 0);
    await page.locator('[data-action="close"]').click();
    assert.equal(await page.locator('[data-list="today"] .add input').count(), 1);
    await context.close();
  });

  await scenario("기존 사용자는 설정에 '무료 사용자'로 보이고 아무것도 막지 않는다", async () => {
    const { page, context } = await openApp(browser, { license: { state: "grandfathered" } });
    assert.equal(await page.locator('[data-list="today"] .add input').count(), 1);
    await openSettings(page);
    assert.equal(await page.locator(".license .state").textContent(), "초기 사용자 · 계속 무료");
    await context.close();
  });

  await scenario("체험이 끝나면 ⌥Space 빠른 입력창도 입력 대신 안내를 보여 준다", async () => {
    const { page, context } = await openApp(browser, {
      hash: "#quick",
      viewport: { width: 620, height: 96 },
      license: { state: "expired" },
    });
    assert.equal(await page.locator(".quick input").count(), 0);
    assert.equal(await page.locator(".quick .locked .msg").textContent(), "체험이 끝났어요");
    await context.close();
  });
}
