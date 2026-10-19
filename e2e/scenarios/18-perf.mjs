import assert from "node:assert/strict";
import { openApp, scenario } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";

export default async function (browser) {
  // UI-05: 위치 읽기와 애니메이션 걸기를 번갈아 하면 WebKit이 행마다 레이아웃을 다시 계산해 항목 수의 제곱으로 느려진다
  await scenario("할 일 1,000개 목록에서 체크해도 정렬(0.5초 뒤)이 오래 멈추지 않는다", async () => {
    const big = Array.from({ length: 1000 }, (_, i) => `- [${i % 3 ? " " : "x"}] 일 ${i}\n`).join("");
    const { page, context, errors } = await openApp(browser, { files: { [TODAY]: big } });
    await page.locator('[data-list="today"] .item .box').nth(1).click();
    await page.clock.runFor(100);
    const t0 = Date.now();
    await page.clock.runFor(500);
    const ms = Date.now() - t0;
    console.log(`      (정렬 ${ms}ms)`);
    assert.ok(ms < 800, `정렬에 ${ms}ms`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("체크해서 자리가 바뀐 화면 안 항목은 미끄러져 가고, 화면 밖 항목에는 애니메이션을 걸지 않는다", async () => {
    const big = Array.from({ length: 200 }, (_, i) => `- [ ] 일 ${i}\n`).join("") + "- [x] 끝\n";
    const { page, context } = await openApp(browser, { files: { [TODAY]: big } });
    await page.locator('[data-list="today"] .item .box').nth(0).click();
    await page.clock.runFor(600);
    const animated = await page.$$eval('[data-list="today"] .item', (els) =>
      els.map((e, i) => [i, e.getAnimations().length]).filter(([, n]) => n > 0).map(([i]) => i),
    );
    console.log(`      (움직인 행 ${JSON.stringify(animated)})`);
    assert.ok(animated.includes(0), `맨 위로 올라온 '일 1'이 움직이지 않았다: ${animated}`);
    // 체크해서 끝낸 일 위(199번 자리)로 간 항목은 화면 안에서 출발하므로 움직인다
    const offscreen = animated.filter((i) => i > 60 && i !== 199);
    assert.deepEqual(offscreen, [], `화면 밖 항목까지 애니메이션: ${animated.length}개`);
    await context.close();
  });
}
