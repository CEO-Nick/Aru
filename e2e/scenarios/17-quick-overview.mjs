import assert from "node:assert/strict";
import { calls, caretToEnd, fs, openApp, paste, scenario, status, texts } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
const QUICK = { hash: "#quick", viewport: { width: 620, height: 96 } };
const BIG = { hash: "#overview", viewport: { width: 1180, height: 760 } };
const hides = async (page) => (await calls(page, "hide_quick")).length;
const NOW = Math.floor(new Date("2026-10-14T10:00:00").getTime() / 1000);

async function dragTo(page, fromSelector, target) {
  const from = page.locator(fromSelector);
  await from.hover();
  const grip = await from.locator(".grip").boundingBox();
  const box = await page.locator(target).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.clock.runFor(10);
}

export default async function (browser) {
  // UI-08
  await scenario("빠른 입력: 저장에 실패하면 알리고, 다른 곳을 누르면 닫히며, 다시 띄우면 쓰던 글이 남아 있다", async () => {
    const { page, context, errors } = await openApp(browser, QUICK);
    await page.evaluate(() => (window.__failWrites = true));
    await page.keyboard.type("잃으면 안 되는 일");
    await page.keyboard.press("Enter");
    await page.clock.runFor(400);
    assert.equal((await page.locator(".hint").textContent()).trim(), "저장하지 못했어요");
    assert.equal(await hides(page), 0, "실패했는데 창을 닫아 글이 안 보이게 됐다");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(10);
    assert.equal(await hides(page), 1, "실패 뒤 다른 곳을 눌러도 닫히지 않는다");
    await page.evaluate(() => (window.__failWrites = false));
    await page.evaluate(() => window.__emit("quick-shown", null));
    await page.clock.runFor(10);
    assert.equal(await page.locator(".quick input").inputValue(), "잃으면 안 되는 일");
    await page.keyboard.press("Enter");
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 잃으면 안 되는 일\n");
    assert.deepEqual(errors.filter((e) => /Unhandled|디스크/.test(e)), []);
    await context.close();
  });

  await scenario("빠른 입력: 저장 실패 뒤 Esc로 닫을 수 있다", async () => {
    const { page, context } = await openApp(browser, QUICK);
    await page.evaluate(() => (window.__failWrites = true));
    await page.keyboard.type("x");
    await page.keyboard.press("Enter");
    await page.clock.runFor(400);
    await page.keyboard.press("Escape");
    await page.clock.runFor(10);
    assert.equal(await hides(page), 1);
    await context.close();
  });

  // UI-09
  await scenario("빠른 입력 직후 0.26초 안에 다시 띄우면 새로 띄운 창이 저절로 닫히지 않는다", async () => {
    const { page, context } = await openApp(browser, QUICK);
    await page.keyboard.type("첫 번째");
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
    await page.evaluate(() => window.__emit("quick-shown", null));
    await page.clock.runFor(10);
    await page.keyboard.type("두 번째");
    await page.clock.runFor(1000);
    assert.equal(await hides(page), 0);
    assert.equal(await page.locator(".quick input").inputValue(), "두 번째");
    await context.close();
  });

  // UI-07
  await scenario("빠른 입력: 오늘 안 끝낸 똑같은 일(앞뒤 공백 무시)은 건너뛰고 알린 뒤 닫힌다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 장보기\n- [x] 운동\n" } });
    await page.keyboard.type("  장보기 ");
    await page.keyboard.press("Enter");
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 장보기\n- [x] 운동\n");
    assert.equal((await page.locator(".hint").textContent()).trim(), "이미 있는 할 일이에요");
    await page.clock.runFor(1000);
    assert.equal(await hides(page), 1);
    await context.close();
  });

  await scenario("빠른 입력: 끝낸 일과 같은 글은 새로 넣는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [x] 운동\n" } });
    await page.keyboard.type("운동");
    await page.keyboard.press("Enter");
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 운동\n- [x] 운동\n");
    await context.close();
  });

  // UI-03
  await scenario("빠른 입력: U+2028·NBSP가 섞여도 한 줄 할 일로 저장된다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 기존\n" } });
    await page.locator(".quick input").fill("복사한\u2028글\u00a0끝");
    await page.keyboard.press("Enter");
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 복사한 글 끝\n- [ ] 기존\n");
    await context.close();
  });

  await scenario("빠른 입력창을 띄우자마자 바로 쳐서 Enter로 넣을 수 있다", async () => {
    const { page, context } = await openApp(browser, QUICK);
    await page.clock.runFor(400);
    await page.keyboard.type("바로");
    await page.keyboard.press("Enter");
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 바로\n");
    await context.close();
  });

  // UI-11
  await scenario("모아보기: 언젠가 항목을 못 읽는 날짜 칸에 놓으면 그대로 남고 실패를 알린다", async () => {
    const { page, context } = await openApp(browser, {
      ...BIG,
      files: { "someday.md": "- [ ] 여권 갱신\n", "daily/2026-10-20.md": "- [ ] 원래\n" },
    });
    await page.evaluate(() => (window.__badReads = ["daily/2026-10-20.md"]));
    await dragTo(page, '[data-list="someday"] .item >> nth=0', '.cell[data-date="2026-10-20"]');
    await page.clock.runFor(1100);
    assert.deepEqual(await texts(page, "someday"), ["여권 갱신"]);
    const files = await fs(page);
    assert.equal(files["someday.md"], "- [ ] 여권 갱신\n");
    assert.equal(files["daily/2026-10-20.md"], "- [ ] 원래\n");
    assert.match(await status(page), /^옮기지 못했어요/);
    await context.close();
  });

  await scenario("모아보기: 날짜 칸에 쓰기가 실패하면 언젠가 항목을 지우지 않는다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, files: { "someday.md": "- [ ] 여권 갱신\n" } });
    await page.evaluate(() => (window.__failWrites = true));
    await dragTo(page, '[data-list="someday"] .item >> nth=0', '.cell[data-date="2026-10-20"]');
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "someday"), ["여권 갱신"]);
    await page.evaluate(() => (window.__failWrites = false));
    await page.clock.runFor(6000);
    assert.equal((await fs(page))["someday.md"], "- [ ] 여권 갱신\n");
    assert.equal((await fs(page))["daily/2026-10-20.md"], undefined);
    await context.close();
  });

  await scenario("모아보기: 언젠가 항목을 날짜 칸에 놓으면 그 날짜에 쓴 뒤 언젠가에서 뺀다", async () => {
    const { page, context } = await openApp(browser, {
      ...BIG,
      files: { "someday.md": "- [ ] 여권 갱신\n- [ ] 남김\n", "daily/2026-10-20.md": "- [ ] 원래\n" },
    });
    await dragTo(page, '[data-list="someday"] .item >> nth=0', '.cell[data-date="2026-10-20"]');
    await page.clock.runFor(10);
    const files = await fs(page);
    assert.equal(files["daily/2026-10-20.md"], "- [ ] 원래\n- [ ] 여권 갱신\n");
    assert.equal(files["someday.md"], "- [ ] 남김\n");
    await context.close();
  });

  // CLI-B3: 같은 도구·같은 초에 서로 다른 파일에 넣은 묶음은 다른 묶음이다
  await scenario("같은 by@at으로 오늘·언젠가에 따로 넣은 AI 묶음은 따로 알리고 따로 되돌린다", async () => {
    const { page, context } = await openApp(browser);
    const marker = `ai:codex@${NOW - 5}`;
    await page.evaluate(
      ([t, m]) => {
        window.__setFile(t, `- [ ] 오늘1 <!-- ${m} -->\n- [ ] 오늘2 <!-- ${m} -->\n`);
        window.__setFile("someday.md", `- [ ] 언젠가1 <!-- ${m} -->\n`);
      },
      [TODAY, marker],
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.clock.runFor(10);
    const notice = page.locator(".foot .ai-added");
    // 같은 시각이라 어느 쪽을 먼저 알릴지는 정하지 않는다. 섞이면 "AI 3개 추가"가 된다
    const first = await notice.locator(".msg").textContent();
    const todayFirst = first === "AI 2개 추가";
    assert.ok(todayFirst || first === "언젠가에 AI 1개 추가", `첫 알림=${first}`);
    await notice.locator('[data-action="undo-ai"]').click();
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "today"), todayFirst ? [] : ["오늘1", "오늘2"]);
    assert.deepEqual(await texts(page, "someday"), todayFirst ? ["언젠가1"] : []);
    assert.equal(await notice.locator(".msg").textContent(), todayFirst ? "언젠가에 AI 1개 추가" : "AI 2개 추가");
    await notice.locator('[data-action="undo-ai"]').click();
    await page.clock.runFor(10);
    assert.deepEqual([...(await texts(page, "today")), ...(await texts(page, "someday"))], []);
    await context.close();
  });
}
