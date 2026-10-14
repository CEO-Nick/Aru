import assert from "node:assert/strict";
import { openApp, scenario, texts } from "../harness.mjs";

async function dragGrip(page, fromSelector, toSelector, position = "top") {
  const from = page.locator(fromSelector);
  await from.hover();
  const grip = await from.locator(".grip").boundingBox();
  const target = await page.locator(toSelector).boundingBox();
  const y = position === "top" ? target.y + 2 : target.y + target.height - 2;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, y, { steps: 8 });
  await page.mouse.up();
}

export default async function (browser) {
  await scenario("입력칸에 쓰고 Enter → 오늘 목록에 추가, 입력칸 비워짐", async () => {
    const { page, context, errors } = await openApp(browser);
    const input = page.locator('[data-list="today"] .add input');
    await input.fill("장보기");
    await input.press("Enter");
    await input.fill("회의 준비");
    await input.press("Enter");
    assert.deepEqual(await texts(page, "today"), ["장보기", "회의 준비"]);
    assert.equal(await input.inputValue(), "");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("체크박스를 눌러야만 완료되고, 글자를 누르면 완료되지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "daily/2026-10-14.md": "- [ ] 장보기\n" },
    });
    const item = page.locator('[data-list="today"] .item').first();
    await item.locator(".text").click();
    assert.equal(await item.evaluate((e) => e.classList.contains("done")), false);
    await item.locator(".box").click();
    assert.equal(await item.evaluate((e) => e.classList.contains("done")), true);
    await context.close();
  });

  await scenario("항목에서 Enter → 아래에 빈 항목 + 커서 이동, 빈 항목 Backspace → 삭제 + 위로", async () => {
    const { page, context } = await openApp(browser, {
      files: { "daily/2026-10-14.md": "- [ ] 하나\n- [ ] 둘\n" },
    });
    const first = page.locator('[data-list="today"] .item .text').first();
    await first.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    assert.deepEqual(await texts(page, "today"), ["하나", "", "둘"]);
    const focusedIndex = await page.evaluate(() =>
      [...document.querySelectorAll('[data-list="today"] .item .text')].indexOf(document.activeElement),
    );
    assert.equal(focusedIndex, 1);
    await page.keyboard.type("사이");
    assert.deepEqual(await texts(page, "today"), ["하나", "사이", "둘"]);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    assert.deepEqual(await texts(page, "today"), ["하나", "둘"]);
    const afterDelete = await page.evaluate(() =>
      [...document.querySelectorAll('[data-list="today"] .item .text')].indexOf(document.activeElement),
    );
    assert.equal(afterDelete, 0);
    await context.close();
  });

  await scenario("글자를 고치는 중 커서가 맨 앞으로 튀지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "daily/2026-10-14.md": "- [ ] 장보기\n" },
    });
    await page.locator('[data-list="today"] .item .text').click();
    await page.keyboard.press("End");
    await page.keyboard.type(" 우유");
    assert.deepEqual(await texts(page, "today"), ["장보기 우유"]);
    await context.close();
  });

  await scenario("손잡이로 같은 목록 안 순서 변경", async () => {
    const { page, context } = await openApp(browser, {
      files: { "daily/2026-10-14.md": "- [ ] 하나\n- [ ] 둘\n- [ ] 셋\n" },
    });
    await dragGrip(page, '[data-list="today"] .item >> nth=2', '[data-list="today"] .item >> nth=0');
    assert.deepEqual(await texts(page, "today"), ["셋", "하나", "둘"]);
    await context.close();
  });

  await scenario("손잡이로 오늘 → 언젠가 이동", async () => {
    const { page, context } = await openApp(browser, {
      files: { "daily/2026-10-14.md": "- [ ] 하나\n- [ ] 둘\n", "someday.md": "- [ ] 여권\n" },
    });
    await dragGrip(page, '[data-list="today"] .item >> nth=0', '[data-list="someday"] .add');
    assert.deepEqual(await texts(page, "today"), ["둘"]);
    assert.deepEqual(await texts(page, "someday"), ["여권", "하나"]);
    await context.close();
  });

  await scenario("가운데 손잡이로 높이 조절, 20~80%에서 멈춤", async () => {
    const { page, context } = await openApp(browser);
    const split = await page.locator(".split").boundingBox();
    const body = await page.locator(".body").boundingBox();
    await page.mouse.move(split.x + split.width / 2, split.y + 4);
    await page.mouse.down();
    await page.mouse.move(split.x + split.width / 2, body.y + 5, { steps: 5 });
    await page.mouse.up();
    const ratio = await page.evaluate(() => {
      const today = document.querySelector(".today").getBoundingClientRect().height;
      const body = document.querySelector(".body").getBoundingClientRect().height;
      return today / body;
    });
    assert.ok(Math.abs(ratio - 0.2) < 0.03, `비율 ${ratio}`);
    await context.close();
  });

  await scenario("넘어온 날짜 꼬리표를 보여주고 누르면 사라진다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "daily/2026-10-14.md": "- [ ] PR 리뷰 <!-- from:2026-10-12 -->\n" },
    });
    const tag = page.locator('[data-list="today"] .from');
    assert.equal(await tag.textContent(), "10/12에서 넘어옴");
    await tag.click();
    assert.equal(await tag.count(), 0);
    await context.close();
  });

  await scenario("항목이 많을 때 Enter로 추가하면 입력칸이 화면 안에 보인다", async () => {
    const many = Array.from({ length: 25 }, (_, i) => `- [ ] 항목 ${i + 1}`).join("\n") + "\n";
    const { page, context } = await openApp(browser, { files: { "daily/2026-10-14.md": many } });
    const input = page.locator('[data-list="today"] .add input');
    await input.focus();
    await input.fill("새 항목");
    await input.press("Enter");
    await page.clock.runFor(50);
    const visible = await page.evaluate(() => {
      const pane = document.querySelector(".today").getBoundingClientRect();
      const add = document.querySelector('[data-list="today"] .add').getBoundingClientRect();
      return add.top >= pane.top && add.bottom <= pane.bottom + 1;
    });
    assert.ok(visible, "입력칸이 화면 밖에 있다");
    await context.close();
  });
}
