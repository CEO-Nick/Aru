import assert from "node:assert/strict";
import { openApp, scenario } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
const todayAdd = (page) => page.locator('[data-list="today"] .add input');
const somedayAdd = (page) => page.locator('[data-list="someday"] .add input');
const somedayItem = (page, n) => page.locator('[data-list="someday"] .item .text').nth(n);

// 지금 포커스가 어느 목록의 어디(할 일 몇 번째 / 입력칸)에 있는지
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const list = el?.closest("[data-list]")?.getAttribute("data-list") ?? null;
    if (el?.closest(".add")) return `${list}:add`;
    const row = el?.closest(".item");
    if (!row) return `${list}:?`;
    return `${list}:${[...row.parentElement.querySelectorAll(".item")].indexOf(row)}`;
  });

export default async function (browser) {
  await scenario("오늘 '새 할 일 입력'에서 ↓를 누르면 언젠가 첫 할 일로 내려간다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [TODAY]: "- [ ] 오늘 일\n", "someday.md": "- [ ] 언젠가 하나\n- [ ] 언젠가 둘\n" },
    });
    await todayAdd(page).click();
    await page.keyboard.press("ArrowDown");
    assert.equal(await focused(page), "someday:0");
    await context.close();
  });

  await scenario("언젠가가 비어 있으면 ↓로 언젠가 입력칸에 내려가고, 쓰던 글은 오늘 입력칸에 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘 일\n" } });
    await todayAdd(page).click();
    await page.keyboard.type("쓰다만");
    await page.keyboard.press("ArrowDown");
    assert.equal(await focused(page), "someday:add");
    assert.equal(await todayAdd(page).inputValue(), "쓰다만");
    await context.close();
  });

  await scenario("언젠가 첫 할 일에서 ↑를 누르면 오늘 '새 할 일 입력'으로 올라간다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [TODAY]: "- [ ] 오늘 일\n", "someday.md": "- [ ] 언젠가 하나\n- [ ] 언젠가 둘\n" },
    });
    await somedayItem(page, 0).click();
    await page.keyboard.press("ArrowUp");
    assert.equal(await focused(page), "today:add");
    await context.close();
  });

  await scenario("언젠가가 비어 있을 때 언젠가 입력칸에서 ↑를 누르면 오늘 입력칸으로 올라간다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 오늘 일\n" } });
    await somedayAdd(page).click();
    await page.keyboard.press("ArrowUp");
    assert.equal(await focused(page), "today:add");
    await context.close();
  });

  await scenario("언젠가 안에서의 ↑↓는 그대로다: 둘째 할 일에서 ↑는 첫 할 일, 마지막 할 일에서 ↓는 언젠가 입력칸", async () => {
    const { page, context } = await openApp(browser, {
      files: { [TODAY]: "- [ ] 오늘 일\n", "someday.md": "- [ ] 언젠가 하나\n- [ ] 언젠가 둘\n" },
    });
    await somedayItem(page, 1).click();
    await page.keyboard.press("ArrowUp");
    assert.equal(await focused(page), "someday:0");
    await somedayItem(page, 1).click();
    await page.keyboard.press("ArrowDown");
    assert.equal(await focused(page), "someday:add");
    await context.close();
  });
}
