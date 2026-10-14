import assert from "node:assert/strict";
import { fs, openApp, scenario, texts } from "../harness.mjs";

const settingsFile = (carryOver, lastRolloverDate = "2026-10-14") =>
  JSON.stringify({ carryOver, lastRolloverDate });

const BEFORE_MIDNIGHT = "2026-10-14T23:59:30";

export default async function (browser) {
  await scenario("[그대로 남기기] 자정이 지나면 위쪽은 새 날짜의 빈 목록, 어제 파일은 그대로", async () => {
    const { page, context, errors } = await openApp(browser, {
      now: BEFORE_MIDNIGHT,
      files: {
        "settings.json": settingsFile("keep"),
        "daily/2026-10-14.md": "- [x] 회의\n- [ ] PR 리뷰\n",
      },
    });
    assert.deepEqual(await texts(page, "today"), ["회의", "PR 리뷰"]);
    await page.clock.runFor(60_000);
    assert.equal(await page.locator(".datebar .date").textContent(), "10월 15일 (목)");
    assert.deepEqual(await texts(page, "today"), []);
    assert.equal((await fs(page))["daily/2026-10-14.md"], "- [x] 회의\n- [ ] PR 리뷰\n");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("[다음 날로] 미완료가 새 날로 넘어오고 '10/14에서 넘어옴'이 붙는다, 어제 파일엔 완료만", async () => {
    const { page, context } = await openApp(browser, {
      now: BEFORE_MIDNIGHT,
      files: {
        "settings.json": settingsFile("next-day"),
        "daily/2026-10-14.md": "- [x] 회의\n- [ ] PR 리뷰\n",
      },
    });
    await page.clock.runFor(60_000);
    assert.deepEqual(await texts(page, "today"), ["PR 리뷰"]);
    assert.equal(await page.locator('[data-list="today"] .from').textContent(), "10/14에서 넘어옴");
    const files = await fs(page);
    assert.equal(files["daily/2026-10-14.md"], "- [x] 회의\n");
    assert.equal(files["daily/2026-10-15.md"], "- [ ] PR 리뷰 <!-- from:2026-10-14 -->\n");
    assert.equal(JSON.parse(files["settings.json"]).lastRolloverDate, "2026-10-15");
    await context.close();
  });

  await scenario("[언젠가로] 미완료가 언젠가 목록 끝으로 간다", async () => {
    const { page, context } = await openApp(browser, {
      now: BEFORE_MIDNIGHT,
      files: {
        "settings.json": settingsFile("someday"),
        "daily/2026-10-14.md": "- [ ] PR 리뷰\n",
        "someday.md": "- [ ] 여권\n",
      },
    });
    await page.clock.runFor(60_000);
    assert.deepEqual(await texts(page, "today"), []);
    assert.deepEqual(await texts(page, "someday"), ["여권", "PR 리뷰"]);
    assert.equal((await fs(page))["someday.md"], "- [ ] 여권\n- [ ] PR 리뷰 <!-- from:2026-10-14 -->\n");
    await context.close();
  });

  await scenario("[다음 날로] 며칠 꺼져 있다 켜면 그동안의 미완료가 오래된 순서로 오늘에 모인다", async () => {
    const { page, context } = await openApp(browser, {
      now: "2026-10-17T09:00:00",
      files: {
        "settings.json": settingsFile("next-day"),
        "daily/2026-10-14.md": "- [ ] 14일 일\n",
        "daily/2026-10-16.md": "- [ ] 16일 예정이던 일\n- [x] 16일 끝낸 일\n",
        "daily/2026-10-17.md": "- [ ] 오늘 미리 적은 일\n",
      },
    });
    assert.deepEqual(await texts(page, "today"), ["오늘 미리 적은 일", "14일 일", "16일 예정이던 일"]);
    const files = await fs(page);
    assert.equal(files["daily/2026-10-14.md"], "");
    assert.equal(files["daily/2026-10-16.md"], "- [x] 16일 끝낸 일\n");
    await context.close();
  });

  await scenario("처음 켤 때는 아무것도 옮기지 않고 오늘을 기준으로 삼는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "daily/2026-10-13.md": "- [ ] 어제 일\n" },
    });
    await page.clock.runFor(1100);
    assert.equal(JSON.parse((await fs(page))["settings.json"]).lastRolloverDate, "2026-10-14");
    assert.equal((await fs(page))["daily/2026-10-13.md"], "- [ ] 어제 일\n");
    await context.close();
  });

  await scenario("지난 날짜를 보던 중 자정이 지나면 보던 날짜에 머문다", async () => {
    const { page, context } = await openApp(browser, {
      now: BEFORE_MIDNIGHT,
      files: { "settings.json": settingsFile("keep"), "daily/2026-10-10.md": "- [ ] 옛날 일\n" },
    });
    for (let i = 0; i < 4; i++) await page.locator('[aria-label="이전 날"]').click();
    await page.clock.runFor(60_000);
    assert.equal(await page.locator(".datebar .date").textContent(), "10월 10일 (토)");
    assert.deepEqual(await texts(page, "today"), ["옛날 일"]);
    await page.locator(".today-btn").click();
    await page.clock.runFor(10);
    assert.equal(await page.locator(".datebar .date").textContent(), "10월 15일 (목)");
    await context.close();
  });
}
