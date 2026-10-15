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
    await page.evaluate(() => window.__emit("update-available", { version: "0.3.0", notes: "" }));
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

  const openSettings = async (page) => {
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(10);
  };

  await scenario("설정 아래에 지금 버전이 보이고, 새 버전이 없으면 확인 버튼만 있다", async () => {
    const { page, context, errors } = await openApp(browser);
    await openSettings(page);
    assert.equal(await page.locator(".about .version").textContent(), "Aru 0.2.1");
    assert.equal(await page.locator('.about [data-action="check-update"]').textContent(), "업데이트 확인");
    assert.equal(await page.locator('.about [data-action="update"]').count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("업데이트 확인을 눌러 최신이면 최신이라고 알려 준다", async () => {
    const { page, context } = await openApp(browser);
    await openSettings(page);
    await page.locator('[data-action="check-update"]').click();
    await page.clock.runFor(10);
    assert.equal((await calls(page, "check_update_now")).length, 1);
    assert.equal(await page.locator(".about .note").textContent(), "최신 버전이에요");
    await context.close();
  });

  await scenario("업데이트 확인으로 새 버전을 찾으면 설정과 창 아래에 함께 업데이트 버튼이 뜬다", async () => {
    const { page, context } = await openApp(browser);
    await page.evaluate(() => (window.__checkResult = "0.3.0"));
    await openSettings(page);
    await page.locator('[data-action="check-update"]').click();
    await page.clock.runFor(10);
    assert.equal(await page.locator('.about [data-action="update"]').textContent(), "0.3.0 업데이트");
    assert.equal(await page.locator('.foot [data-action="update"]').textContent(), "0.3.0 업데이트");
    await context.close();
  });

  await scenario("확인 중에는 다시 누를 수 없고, 실패하면 실패를 알린다", async () => {
    const { page, context } = await openApp(browser);
    await page.evaluate(() => {
      window.__checkDelay = 3000;
      window.__failCheck = true;
    });
    await openSettings(page);
    const check = page.locator('[data-action="check-update"]');
    await check.click();
    await page.clock.runFor(10);
    assert.equal(await check.textContent(), "확인 중…");
    assert.equal(await check.isDisabled(), true);
    await page.clock.runFor(3100);
    assert.equal(await page.locator(".about .note").textContent(), "확인하지 못했어요. 인터넷 연결을 확인해 주세요");
    assert.equal(await check.isDisabled(), false);
    await context.close();
  });

  await scenario("설정에서 업데이트를 누르면 창 아래 버튼도 받는 중으로 바뀐다", async () => {
    const { page, context } = await openApp(browser, { pendingUpdate: "0.2.2" });
    await page.evaluate(() => (window.__installDelay = 5000));
    await openSettings(page);
    await page.locator('.about [data-action="update"]').click();
    await page.clock.runFor(10);
    assert.equal(await page.locator('.foot [data-action="update"]').textContent(), "받는 중…");
    assert.equal((await calls(page, "install_update")).length, 1);
    await context.close();
  });

  const NOTES = "- 설정에서 지금 버전을 볼 수 있어요\n- \"업데이트 확인\"으로 새 버전을 바로 찾아요";

  await scenario("새 버전이 있으면 설정에 무엇이 바뀌는지 목록으로 보여 준다", async () => {
    const { page, context } = await openApp(browser, { pendingUpdate: { version: "0.2.2", notes: NOTES } });
    await openSettings(page);
    assert.deepEqual(await page.$$eval(".about .notes li", (els) => els.map((e) => e.textContent)), [
      "설정에서 지금 버전을 볼 수 있어요",
      '"업데이트 확인"으로 새 버전을 바로 찾아요',
    ]);
    await context.close();
  });

  await scenario("창 아래 업데이트 버튼에 마우스를 올리면 바뀌는 내용이 보인다", async () => {
    const { page, context } = await openApp(browser, { pendingUpdate: { version: "0.2.2", notes: NOTES } });
    const title = await page.locator('.foot [data-action="update"]').getAttribute("title");
    assert.ok(title.includes("설정에서 지금 버전을 볼 수 있어요"), title);
    await context.close();
  });

  await scenario("업데이트하고 다시 켜지면 창 아래에 새 버전으로 바뀌었다고 잠깐 알린다", async () => {
    const { page, context } = await openApp(browser, { storage: { "aru.lastVersion": "0.2.0" } });
    const notice = page.locator(".foot .updated");
    assert.equal(await notice.textContent(), "0.2.1로 업데이트됨");
    await page.clock.runFor(6000);
    assert.equal(await notice.count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("aru.lastVersion")), "0.2.1");
    await context.close();
  });

  await scenario("처음 설치해 켰을 때는 업데이트 알림을 띄우지 않는다", async () => {
    const { page, context } = await openApp(browser);
    assert.equal(await page.locator(".foot .updated").count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("aru.lastVersion")), "0.2.1");
    await context.close();
  });

  await scenario("설정의 '의견 보내기'를 누르면 앱 버전과 macOS 버전이 채워진 피드백 폼을 브라우저로 연다", async () => {
    const { page, context, errors } = await openApp(browser);
    await openSettings(page);
    await page.locator('[data-action="feedback"]').click();
    await page.clock.runFor(10);
    const opened = await calls(page, "plugin:opener|open_url");
    assert.equal(opened.length, 1);
    const url = new URL(opened[0].url);
    assert.equal(url.origin + url.pathname, "https://tally.so/r/laDqkN");
    assert.equal(url.searchParams.get("version"), "0.2.1");
    assert.equal(url.searchParams.get("os"), "macOS 15.1");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("가장 작은 창에서도 설정 아래 버전·업데이트·의견 보내기 줄이 한 줄로 보인다", async () => {
    const { page, context } = await openApp(browser, { viewport: { width: 260, height: 470 }, pendingUpdate: "0.2.10" });
    await openSettings(page);
    const oneLine = (sel) =>
      page.locator(sel).evaluate((e) => {
        const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.4;
        return e.getBoundingClientRect().height < lh * 1.8;
      });
    for (const sel of [".about .hint", '.about [data-action="feedback"]', ".about .version", '.about [data-action="update"]']) {
      assert.ok(await oneLine(sel), `${sel}가 두 줄로 꺾였다`);
    }
    await context.close();
  });
}
