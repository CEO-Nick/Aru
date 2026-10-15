import assert from "node:assert/strict";
import { fs, openApp, scenario, texts, caretToEnd } from "../harness.mjs";

export default async function (browser) {
  await scenario("◀ 로 어제로 가면 어제 할 일이 보이고 '지난 날짜' 꼬리표가 붙는다, 고치면 어제 파일에 저장", async () => {
    const { page, context, errors } = await openApp(browser, {
      files: { "daily/2026-10-13.md": "- [ ] 어제 일\n", "daily/2026-10-14.md": "- [ ] 오늘 일\n" },
    });
    await page.locator('[aria-label="이전 날"]').click();
    await page.clock.runFor(10);
    assert.equal(await page.locator(".datebar .date").textContent(), "10월 13일 (화)");
    assert.equal(await page.locator(".datebar .tag").textContent(), "지난 날짜");
    assert.deepEqual(await texts(page, "today"), ["어제 일"]);
    await page.locator('[data-list="today"] .item .box').click();
    await page.clock.runFor(10);
    assert.equal((await fs(page))["daily/2026-10-13.md"], "- [x] 어제 일\n");
    assert.equal((await fs(page))["daily/2026-10-14.md"], "- [ ] 오늘 일\n");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("'오늘' 버튼으로 돌아온다", async () => {
    const { page, context } = await openApp(browser, { files: { "daily/2026-10-14.md": "- [ ] 오늘 일\n" } });
    await page.locator('[aria-label="이전 날"]').click();
    await page.locator('[aria-label="이전 날"]').click();
    await page.locator(".today-btn").click();
    await page.clock.runFor(10);
    assert.equal(await page.locator(".datebar .tag").count(), 0);
    assert.deepEqual(await texts(page, "today"), ["오늘 일"]);
    await context.close();
  });

  await scenario("고치던 중에 날짜를 넘기면 고친 내용은 원래 날짜 파일에 저장된다", async () => {
    const { page, context } = await openApp(browser, { files: { "daily/2026-10-14.md": "- [ ] 오늘 일\n" } });
    await page.locator('[data-list="today"] .item .text').click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.locator('[aria-label="다음 날"]').click();
    await page.clock.runFor(10);
    const files = await fs(page);
    assert.equal(files["daily/2026-10-14.md"], "- [ ] 오늘 일!\n");
    assert.equal(files["daily/2026-10-15.md"], undefined);
    assert.deepEqual(await texts(page, "today"), []);
    await context.close();
  });

  await scenario("미래 날짜에 적어 둔 일은 그 날이 되면 오늘 목록에 보인다", async () => {
    const { page, context } = await openApp(browser, { now: "2026-10-14T23:59:00" });
    await page.locator('[aria-label="다음 날"]').click();
    await page.clock.runFor(10);
    assert.equal(await page.locator(".datebar .tag").textContent(), "예정");
    const input = page.locator('[data-list="today"] .add input');
    await input.fill("치과 예약");
    await input.press("Enter");
    await page.locator(".today-btn").click();
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "today"), []);

    await page.clock.runFor(90_000);
    assert.equal(await page.locator(".datebar .date").textContent(), "10월 15일 (목)");
    assert.equal(await page.locator(".datebar .tag").count(), 0);
    assert.deepEqual(await texts(page, "today"), ["치과 예약"]);
    await context.close();
  });

  await scenario("창을 가장 작게(260px) 줄여도 날짜 막대가 한 줄을 유지한다 (지난 날짜·예정 모두)", async () => {
    const { page, context } = await openApp(browser, { viewport: { width: 260, height: 470 } });
    for (const step of ["다음 날", "이전 날", "이전 날"]) {
      await page.locator(`[aria-label="${step}"]`).click();
      await page.clock.runFor(10);
      const bar = await page.locator(".datebar").evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        overflow: el.scrollWidth - el.clientWidth,
        dateLines: Math.round(el.querySelector(".date").getBoundingClientRect().height / 20),
        todayHeight: el.querySelector(".today-btn").getBoundingClientRect().height,
      }));
      assert.ok(bar.height < 40 && bar.overflow <= 0 && bar.dateLines <= 1 && bar.todayHeight < 26, JSON.stringify(bar));
    }
    await context.close();
  });
}
