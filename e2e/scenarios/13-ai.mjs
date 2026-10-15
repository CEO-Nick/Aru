import assert from "node:assert/strict";
import { fs, openApp, scenario, texts } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
// 하네스 시계는 2026-10-14 10:00(현지)
const NOW = Math.floor(new Date("2026-10-14T10:00:00").getTime() / 1000);
const tag = (page, text) => page.locator('[data-list="today"] .item', { hasText: text }).locator(".ai");

export default async function (browser) {
  await scenario("AI가 넣은 할 일에는 AI 태그가 붙고, 누가 언제 넣었는지 보인다", async () => {
    const { page, context, errors } = await openApp(browser, {
      files: { [TODAY]: `- [ ] PR 리뷰 <!-- ai:claude-code@${NOW - 3600} -->\n- [ ] 장보기\n` },
    });
    assert.equal(await tag(page, "PR 리뷰").textContent(), "AI");
    assert.equal(await tag(page, "PR 리뷰").getAttribute("title"), "Claude Code가 09:00에 추가 · 누르면 확인");
    assert.equal(await tag(page, "장보기").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("AI 태그를 누르면 태그가 사라지고 일반 할 일이 된다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [TODAY]: `- [ ] PR 리뷰 <!-- ai:codex@${NOW - 3600} -->\n` },
    });
    await tag(page, "PR 리뷰").click();
    await page.clock.runFor(10);
    assert.equal(await tag(page, "PR 리뷰").count(), 0);
    assert.equal((await fs(page))[TODAY], "- [ ] PR 리뷰\n");
    await context.close();
  });

  await scenario("AI 할 일을 체크하면 태그도 같이 사라진다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [TODAY]: `- [ ] PR 리뷰 <!-- ai:codex@${NOW - 3600} -->\n` },
    });
    await page.locator('[data-list="today"] .item .box').click();
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [x] PR 리뷰\n");
    await context.close();
  });

  await scenario("방금 AI가 여러 개를 넣으면 창 아래에 알리고, 되돌리기를 누르면 그 묶음만 지운다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    const batch = `ai:claude-code@${NOW - 5}`;
    await page.evaluate(
      ([p, c]) => window.__setFile(p, c),
      [TODAY, `- [ ] 기획서 <!-- ${batch} -->\n- [ ] 리뷰 <!-- ${batch} -->\n- [ ] 장보기\n`],
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "today"), ["기획서", "리뷰", "장보기"]);
    const notice = page.locator(".foot .ai-added");
    assert.equal(await notice.locator(".msg").textContent(), "Claude Code가 2개 추가");
    await notice.locator('[data-action="undo-ai"]').click();
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "today"), ["장보기"]);
    assert.equal((await fs(page))[TODAY], "- [ ] 장보기\n");
    assert.equal(await notice.count(), 0);
    await context.close();
  });

  await scenario("알림은 1분 동안 보이다 사라지고, 오래전에 넣은 AI 할 일로는 알리지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [TODAY]: `- [ ] 예전 <!-- ai:codex@${NOW - 3600} -->\n- [ ] 방금 <!-- ai:codex@${NOW - 5} -->\n` },
    });
    const notice = page.locator(".foot .ai-added");
    assert.equal(await notice.locator(".msg").textContent(), "Codex가 1개 추가");
    await page.clock.runFor(50_000);
    assert.equal(await notice.count(), 1, "1분이 안 됐는데 알림이 사라졌다");
    await page.clock.runFor(11_000);
    assert.equal(await notice.count(), 0);
    await context.close();
  });

  await scenario("설정에서 'AI·명령어로 추가'를 끄면 settings.json에 저장된다", async () => {
    const { page, context } = await openApp(browser);
    await page.locator('[aria-label="설정"]').click();
    const sw = page.locator('[role="switch"][data-setting="allowExternalAdd"]');
    assert.equal(await sw.getAttribute("aria-checked"), "true");
    await sw.click();
    await page.clock.runFor(1100);
    assert.equal(JSON.parse((await fs(page))["settings.json"]).allowExternalAdd, false);
    await context.close();
  });

  await scenario("창을 건드리지 않아도 AI가 넣은 할 일이 몇 초 안에 나타나고 알림이 뜬다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    await page.clock.runFor(5000);
    await page.evaluate(
      ([p, c]) => window.__setFile(p, c),
      [TODAY, `- [ ] 기획서 <!-- ai:claude-code@${NOW + 5} -->\n- [ ] 장보기\n`],
    );
    await page.clock.runFor(3500);
    assert.deepEqual(await texts(page, "today"), ["기획서", "장보기"]);
    assert.equal(await page.locator(".foot .ai-added .msg").textContent(), "Claude Code가 1개 추가");
    await context.close();
  });

  await scenario("묶음의 AI 태그를 모두 확인하면 되돌리기 알림도 사라진다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [TODAY]: `- [ ] 가 <!-- ai:codex@${NOW - 5} -->\n- [ ] 나 <!-- ai:codex@${NOW - 5} -->\n` },
    });
    const notice = page.locator(".foot .ai-added");
    assert.equal(await notice.count(), 1);
    await tag(page, "가").click();
    await page.clock.runFor(10);
    assert.equal(await notice.count(), 1, "아직 하나 남았는데 사라졌다");
    await tag(page, "나").click();
    await page.clock.runFor(10);
    assert.equal(await notice.count(), 0);
    await context.close();
  });

  await scenario("내일이나 지난 날에 넣어도 날짜를 붙여 알리고, 되돌리기는 그 날짜 파일에서 지운다", async () => {
    const TOMORROW = "daily/2026-10-15.md";
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 장보기\n" } });
    await page.evaluate(
      ([p, c, b]) => {
        window.__setFile(p, c);
        window.__aiBatches = [b];
      },
      [
        TOMORROW,
        `- [ ] 기획서 <!-- ai:claude-code@${NOW + 5} -->\n- [ ] 리뷰 <!-- ai:claude-code@${NOW + 5} -->\n- [ ] 원래 일\n`,
        { by: "claude-code", at: NOW + 5, path: TOMORROW, count: 2 },
      ],
    );
    await page.clock.runFor(3500);
    const notice = page.locator(".foot .ai-added");
    assert.equal(await notice.locator(".msg").textContent(), "Claude Code가 10/15에 2개 추가");
    await notice.locator('[data-action="undo-ai"]').click();
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TOMORROW], "- [ ] 원래 일\n");
    assert.equal((await fs(page))[TODAY], "- [ ] 장보기\n");
    assert.equal(await notice.count(), 0);
    await context.close();
  });

  await scenario("언젠가에 넣으면 '언젠가에'를 붙여 알린다", async () => {
    const { page, context } = await openApp(browser);
    await page.evaluate(
      ([c, b]) => {
        window.__setFile("someday.md", c);
        window.__aiBatches = [b];
      },
      [`- [ ] 여권 <!-- ai:codex@${NOW + 5} -->\n`, { by: "codex", at: NOW + 5, path: "someday.md", count: 1 }],
    );
    await page.clock.runFor(3500);
    assert.equal(await page.locator(".foot .ai-added .msg").textContent(), "Codex가 언젠가에 1개 추가");
    await context.close();
  });
}
