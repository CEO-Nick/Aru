import assert from "node:assert/strict";
import { fs, openApp, scenario, texts, writes, caretToEnd } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";

export default async function (browser) {
  await scenario("할 일을 추가하면 바로 오늘 날짜 파일에 저장된다", async () => {
    const { page, context, errors } = await openApp(browser);
    const input = page.locator('[data-list="today"] .add input');
    await input.fill("장보기");
    await input.press("Enter");
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 장보기\n");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("글자 수정은 입력을 멈추고 1초 뒤에 한 번 저장된다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    await page.locator('[data-list="today"] .item .text').click();
    await caretToEnd(page);
    await page.keyboard.type(" 우유");
    const todayWrites = async () => (await writes(page)).filter(([p]) => p === TODAY);
    await page.clock.runFor(900);
    assert.equal((await todayWrites()).length, 0, "1초 전에 저장됐다");
    assert.equal(await page.locator(".status").textContent(), "저장 대기 중…");
    await page.clock.runFor(200);
    assert.deepEqual(await todayWrites(), [[TODAY, "- [ ] 장보기 우유\n"]]);
    assert.equal(await page.locator(".status").textContent(), "저장됨");
    await context.close();
  });

  await scenario("체크는 즉시 저장된다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    await page.locator('[data-list="today"] .item .box').click();
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [x] 장보기\n");
    await context.close();
  });

  await scenario("언젠가 목록은 someday.md에 저장된다", async () => {
    const { page, context } = await openApp(browser);
    const input = page.locator('[data-list="someday"] .add input');
    await input.fill("여권 갱신");
    await input.press("Enter");
    await page.clock.runFor(10);
    assert.equal((await fs(page))["someday.md"], "- [ ] 여권 갱신\n");
    await context.close();
  });

  await scenario("앱을 다시 켜면(새로고침) 저장된 내용이 그대로 보인다", async () => {
    const { page, context } = await openApp(browser);
    await page.locator('[data-list="today"] .add input').fill("오늘 일");
    await page.locator('[data-list="today"] .add input').press("Enter");
    await page.locator('[data-list="someday"] .add input').fill("언젠가 일");
    await page.locator('[data-list="someday"] .add input').press("Enter");
    await page.clock.runFor(10);
    await page.reload();
    await page.waitForSelector(".foot");
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "today"), ["오늘 일"]);
    assert.deepEqual(await texts(page, "someday"), ["언젠가 일"]);
    await context.close();
  });

  await scenario("다른 편집기에서 적은 메모는 체크하고 저장해도 남는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [TODAY]: "- [ ] PR 리뷰\n\n회의 메모: 배포는 금요일\n" },
    });
    await page.locator('[data-list="today"] .item .box').click();
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [x] PR 리뷰\n\n회의 메모: 배포는 금요일\n");
    await context.close();
  });

  await scenario("창에서 벗어나면 기다리던 저장을 바로 쓴다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    await page.locator('[data-list="today"] .item .text').click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 장보기!\n");
    await context.close();
  });

  await scenario("메뉴 막대에서 종료하면 기다리던 저장을 쓰고 나서 끈다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    await page.locator('[data-list="today"] .item .text').click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.evaluate(() => window.__emit("quit-requested"));
    await page.clock.runFor(10);
    const calls = await page.evaluate(() => window.__calls.map(([c]) => c));
    assert.equal((await fs(page))[TODAY], "- [ ] 장보기!\n");
    assert.ok(calls.indexOf("quit_ready") > calls.lastIndexOf("write_text"), "저장 전에 종료 준비를 알렸다");
    await context.close();
  });

  await scenario("다른 편집기에서 파일을 고치면 창에 돌아왔을 때 다시 읽는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    await page.evaluate((p) => window.__setFile(p, "- [ ] 하나\n- [ ] 밖에서 추가\n"), TODAY);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "today"), ["하나", "밖에서 추가"]);
    const rewrites = (await writes(page)).filter(([p]) => p === TODAY);
    assert.equal(rewrites.length, 0, `다시 읽은 내용을 괜히 다시 썼다: ${JSON.stringify(await writes(page))}`);
    await context.close();
  });

  await scenario("할 일이 없는 날은 파일을 만들지 않는다", async () => {
    const { page, context } = await openApp(browser);
    await page.clock.runFor(2000);
    assert.equal((await fs(page))[TODAY], undefined);
    await context.close();
  });

  await scenario("투명도와 높이 비율은 settings.json에 저장되고 다시 켜면 복원된다", async () => {
    const { page, context } = await openApp(browser);
    await page.locator('input[type="range"]').fill("30");
    await page.clock.runFor(1100);
    const settings = JSON.parse((await fs(page))["settings.json"]);
    assert.equal(settings.opacity, 30);
    await page.reload();
    await page.waitForSelector(".foot");
    await page.clock.runFor(10);
    assert.equal(await page.locator('input[type="range"]').inputValue(), "30");
    const opacityCalls = await page.evaluate(() =>
      window.__calls.filter(([c]) => c === "set_window_opacity").map(([, a]) => a.alpha),
    );
    assert.ok(Math.abs(opacityCalls.at(-1) - 0.44) < 0.001, `투명도 ${opacityCalls}`);
    await context.close();
  });

  await scenario("핀 버튼으로 항상 위 고정을 끄고 켜며, 상태는 다시 켜도 유지된다", async () => {
    const { page, context } = await openApp(browser);
    const pin = page.locator('[aria-label="항상 위에 고정"]');
    const pinCalls = () =>
      page.evaluate(() =>
        window.__calls.filter(([c]) => c === "plugin:window|set_always_on_top").map(([, a]) => a.value),
      );
    assert.equal(await pin.getAttribute("aria-pressed"), "true");
    await pin.click();
    assert.equal(await pin.getAttribute("aria-pressed"), "false");
    assert.deepEqual(await pinCalls(), [false]);
    await page.clock.runFor(1100);
    assert.equal(JSON.parse((await fs(page))["settings.json"]).alwaysOnTop, false);

    await page.reload();
    await page.waitForSelector(".foot");
    await page.clock.runFor(10);
    assert.equal(await pin.getAttribute("aria-pressed"), "false");
    assert.deepEqual(await pinCalls(), [false], "다시 켰을 때 고정 해제를 적용하지 않았다");

    await pin.click();
    assert.deepEqual(await pinCalls(), [false, true]);
    await context.close();
  });

  await scenario("저장에 실패하면 실패 표시가 나오고, 다음 기회에 다시 쓴다", async () => {
    const { page, context } = await openApp(browser);
    await page.evaluate(() => (window.__failWrites = true));
    await page.locator('[data-list="today"] .add input').fill("장보기");
    await page.locator('[data-list="today"] .add input').press("Enter");
    await page.clock.runFor(10);
    assert.equal(await page.locator(".status").textContent(), "저장 실패 — 다시 시도합니다");
    await page.evaluate(() => (window.__failWrites = false));
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 장보기\n");
    assert.equal(await page.locator(".status").textContent(), "저장됨");
    await context.close();
  });

  await scenario("Cmd+S를 누르면 기다리지 않고 바로 저장되고, 저장 표시가 반짝이며 시각이 붙는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    await page.locator('[data-list="today"] .item .text').click();
    await caretToEnd(page);
    await page.keyboard.type(" 우유");
    await page.keyboard.press("Meta+s");
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 장보기 우유\n");
    assert.ok(await page.locator(".foot").evaluate((e) => e.classList.contains("flash")), "반짝이지 않는다");
    assert.equal(await page.locator(".foot .time").textContent(), "10:00");
    await page.clock.runFor(1300);
    assert.ok(!(await page.locator(".foot").evaluate((e) => e.classList.contains("flash"))));
    await context.close();
  });

  await scenario("저장할 게 없어도 Cmd+S를 누르면 저장 표시가 반짝여 눌렀다는 걸 알려 준다", async () => {
    const { page, context } = await openApp(browser);
    await page.clock.runFor(2000);
    await page.keyboard.press("Meta+s");
    await page.clock.runFor(10);
    assert.ok(await page.locator(".foot").evaluate((e) => e.classList.contains("flash")));
    await context.close();
  });

  await scenario("자동저장이 끝날 때도 저장 표시가 반짝인다", async () => {
    const { page, context } = await openApp(browser);
    await page.clock.runFor(2000);
    await page.locator('[data-list="today"] .add input').fill("장보기");
    await page.locator('[data-list="today"] .add input').press("Enter");
    await page.clock.runFor(10);
    assert.ok(await page.locator(".foot").evaluate((e) => e.classList.contains("flash")));
    await context.close();
  });

  await scenario("입력칸에 쓰고 Enter 없이 Cmd+S를 누르면 할 일로 등록되고 바로 저장되며, 커서는 입력칸에 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    const input = page.locator('[data-list="today"] .add input');
    await input.click();
    await page.keyboard.type("쓰다 만 일");
    await page.keyboard.press("Meta+s");
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 하나\n- [ ] 쓰다 만 일\n");
    assert.deepEqual(await texts(page, "today"), ["하나", "쓰다 만 일"]);
    assert.equal(await input.inputValue(), "");
    assert.ok(await input.evaluate((e) => e === document.activeElement), "커서가 입력칸을 벗어났다");
    await context.close();
  });

  await scenario("입력칸에 글이 남은 채 앱을 끄면 그 글도 할 일로 저장된다", async () => {
    const { page, context } = await openApp(browser);
    await page.locator('[data-list="someday"] .add input').fill("언젠가 쓰다 만 일");
    await page.evaluate(() => window.__emit("quit-requested"));
    await page.clock.runFor(10);
    assert.equal((await fs(page))["someday.md"], "- [ ] 언젠가 쓰다 만 일\n");
    await context.close();
  });
}
