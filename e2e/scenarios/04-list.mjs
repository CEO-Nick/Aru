import assert from "node:assert/strict";
import { fs, openApp, scenario, texts, caretToEnd } from "../harness.mjs";

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
    await caretToEnd(page);
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
    await caretToEnd(page);
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

  await scenario("빈 입력칸에서 Backspace → 마지막 할 일 끝으로 올라가고, 한 번 더 누르면 그 글자를 지운다", async () => {
    const { page, context } = await openApp(browser, { files: { "daily/2026-10-14.md": "- [ ] 하나\n- [ ] 장보기\n" } });
    await page.locator('[data-list="today"] .add input').click();
    await page.keyboard.press("Backspace");
    const focused = await page.evaluate(() =>
      [...document.querySelectorAll('[data-list="today"] .item .text')].indexOf(document.activeElement),
    );
    assert.equal(focused, 1);
    assert.deepEqual(await texts(page, "today"), ["하나", "장보기"]);
    await page.keyboard.press("Backspace");
    assert.deepEqual(await texts(page, "today"), ["하나", "장보"]);
    await context.close();
  });

  await scenario("글자 중간에서 Enter → 커서 뒤가 새 할 일로 내려가고, 거기서 바로 이어 쓸 수 있다. 맨 앞 Backspace로 다시 합쳐진다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "daily/2026-10-14.md": "- [ ] 전자고지서 스테이지 배포하기\n" },
    });
    await page.locator('[data-list="today"] .item .text').click();
    await caretToEnd(page);
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    assert.deepEqual(await texts(page, "today"), ["전자고지서 스테이지", "배포하기"]);
    await page.keyboard.type("오늘 ");
    assert.deepEqual(await texts(page, "today"), ["전자고지서 스테이지", "오늘 배포하기"]);
    await page.clock.runFor(1100);
    assert.equal((await fs(page))["daily/2026-10-14.md"], "- [ ] 전자고지서 스테이지\n- [ ] 오늘 배포하기\n");

    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");
    assert.deepEqual(await texts(page, "today"), ["전자고지서 스테이지 오늘 배포하기"]);
    await page.keyboard.type("꼭 ");
    assert.deepEqual(await texts(page, "today"), ["전자고지서 스테이지 꼭 오늘 배포하기"]);
    await context.close();
  });

  await scenario("체크하면 0.5초 뒤 끝낸 일들 맨 위로 내려가고 파일 순서도 바뀐다, 그 사이 다시 누르면 취소된다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "daily/2026-10-14.md": "- [ ] 하나\n- [ ] 둘\n- [ ] 셋\n- [x] 어제 끝낸 일\n" },
    });
    const box = (text) => page.locator('[data-list="today"] .item', { hasText: text }).locator(".box");
    await box("하나").click();
    await page.clock.runFor(400);
    assert.deepEqual(await texts(page, "today"), ["하나", "둘", "셋", "어제 끝낸 일"]);
    await page.clock.runFor(150);
    assert.deepEqual(await texts(page, "today"), ["둘", "셋", "하나", "어제 끝낸 일"]);
    assert.equal((await fs(page))["daily/2026-10-14.md"], "- [ ] 둘\n- [ ] 셋\n- [x] 하나\n- [x] 어제 끝낸 일\n");

    await box("둘").click();
    await page.clock.runFor(250);
    await box("둘").click();
    await page.clock.runFor(2000);
    assert.deepEqual(await texts(page, "today"), ["둘", "셋", "하나", "어제 끝낸 일"]);

    await box("하나").click();
    await page.clock.runFor(1100);
    assert.deepEqual(await texts(page, "today"), ["둘", "셋", "하나", "어제 끝낸 일"], "체크를 풀면 남은 일들 맨 아래로");
    await context.close();
  });

  await scenario("다른 할 일을 고치는 중에 체크한 할 일이 내려가도 커서와 입력이 끊기지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "daily/2026-10-14.md": "- [ ] 하나\n- [ ] 둘\n- [ ] 셋\n" },
    });
    await page.locator('[data-list="today"] .item .box').first().click();
    await page.locator('[data-list="today"] .item .text').nth(2).click();
    await caretToEnd(page);
    await page.keyboard.type(" 가");
    await page.clock.runFor(1100);
    await page.keyboard.type("나");
    assert.deepEqual(await texts(page, "today"), ["둘", "셋 가나", "하나"]);
    await page.clock.runFor(1100);
    assert.equal((await fs(page))["daily/2026-10-14.md"], "- [ ] 둘\n- [ ] 셋 가나\n- [x] 하나\n");
    await context.close();
  });

  await scenario("설정에서 '아래로 보내기'를 끄면 체크해도 그 자리에 남는다", async () => {
    const { page, context } = await openApp(browser, {
      files: {
        "daily/2026-10-14.md": "- [ ] 하나\n- [ ] 둘\n",
        "settings.json": JSON.stringify({ sortChecked: false }),
      },
    });
    await page.locator('[data-list="today"] .item .box').first().click();
    await page.clock.runFor(2000);
    assert.deepEqual(await texts(page, "today"), ["하나", "둘"]);
    await page.locator('[aria-label="설정"]').click();
    await page.locator('[role="switch"]').click();
    await page.clock.runFor(10);
    assert.equal(JSON.parse((await fs(page))["settings.json"]).sortChecked, true);
    await context.close();
  });

  await scenario("체크한 그 할 일을 1초 안에 고치기 시작해도, 옮겨진 뒤 커서가 그 칸에 남아 이어서 쓸 수 있다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "daily/2026-10-14.md": "- [ ] 하나\n- [ ] 둘\n" },
    });
    await page.locator('[data-list="today"] .item .box').first().click();
    await page.locator('[data-list="today"] .item .text').first().click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.clock.runFor(1100);
    await page.keyboard.type("?");
    assert.deepEqual(await texts(page, "today"), ["둘", "하나!?"]);
    await context.close();
  });
}
