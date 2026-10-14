import assert from "node:assert/strict";
import { fs, openApp, scenario, texts } from "../harness.mjs";

const BIG = { hash: "#overview", viewport: { width: 1180, height: 760 } };

const cellTexts = (page, date) =>
  page.$$eval(`.cell[data-date="${date}"] .mi`, (els) => els.map((e) => e.textContent.trim()));

export default async function (browser) {
  await scenario("월 달력 칸마다 그 날의 할 일 제목이 보이고, 넘치면 +N", async () => {
    const { page, context, errors } = await openApp(browser, {
      ...BIG,
      files: {
        "daily/2026-10-12.md": "- [x] 주간 회의\n- [x] PR 리뷰\n- [ ] 메일 정리\n- [ ] 정산\n- [ ] 위키\n",
        "daily/2026-10-16.md": "- [ ] 치과 예약\n",
      },
    });
    assert.equal(await page.locator(".month").textContent(), "2026년 10월");
    assert.deepEqual(await cellTexts(page, "2026-10-12"), ["주간 회의", "PR 리뷰", "메일 정리"]);
    assert.equal((await page.locator('.cell[data-date="2026-10-12"] .more').textContent()).trim(), "+2");
    assert.deepEqual(await cellTexts(page, "2026-10-16"), ["치과 예약"]);
    assert.equal((await page.locator(".summary").textContent()).trim(), "이번 달 완료 2 · 미완료 4");
    assert.ok(await page.locator('.cell[data-date="2026-10-14"]').evaluate((e) => e.classList.contains("today")));
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("날짜를 누르면 오른쪽에서 그 날 할 일을 고치고, 달력 칸과 파일에 바로 반영된다", async () => {
    const { page, context } = await openApp(browser, BIG);
    await page.locator('.cell[data-date="2026-10-20"]').click();
    await page.clock.runFor(10);
    assert.equal((await page.locator(".side-date").textContent()).trim(), "10월 20일 (화)");
    assert.equal((await page.locator(".side .tag").textContent()).trim(), "예정");
    const input = page.locator('[data-list="overview"] .add input');
    await input.fill("보고서 제출");
    await input.press("Enter");
    await page.clock.runFor(10);
    assert.deepEqual(await cellTexts(page, "2026-10-20"), ["보고서 제출"]);
    assert.equal((await fs(page))["daily/2026-10-20.md"], "- [ ] 보고서 제출\n");
    await page.locator('[data-list="overview"] .item .box').click();
    await page.clock.runFor(10);
    assert.equal((await fs(page))["daily/2026-10-20.md"], "- [x] 보고서 제출\n");
    await context.close();
  });

  await scenario("◀ ▶ 로 달을 넘기면 그 달 할 일을 읽는다", async () => {
    const { page, context } = await openApp(browser, {
      ...BIG,
      files: { "daily/2026-11-03.md": "- [ ] 11월 일\n" },
    });
    await page.locator('[aria-label="다음 달"]').click();
    await page.clock.runFor(10);
    assert.equal(await page.locator(".month").textContent(), "2026년 11월");
    assert.deepEqual(await cellTexts(page, "2026-11-03"), ["11월 일"]);
    await page.locator(".pill").click();
    await page.clock.runFor(10);
    assert.equal(await page.locator(".month").textContent(), "2026년 10월");
    await context.close();
  });

  await scenario("작은 창이 같은 날짜를 고치면 모아보기 창이 다시 읽는다", async () => {
    const { page, context } = await openApp(browser, {
      ...BIG,
      files: { "daily/2026-10-14.md": "- [ ] 하나\n" },
    });
    await page.evaluate(() => {
      window.__setFile("daily/2026-10-14.md", "- [ ] 하나\n- [ ] 작은 창에서 추가\n");
      window.__emit("file-changed", { path: "daily/2026-10-14.md", source: "main" });
    });
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "overview"), ["하나", "작은 창에서 추가"]);
    assert.deepEqual(await cellTexts(page, "2026-10-14"), ["하나", "작은 창에서 추가"]);
    await context.close();
  });

  await scenario("'작은 창에서 보기'는 고른 날짜를 작은 창에 보내고, 작은 창은 그 날짜로 이동한다", async () => {
    const big = await openApp(browser, BIG);
    await big.page.locator('.cell[data-date="2026-10-16"]').click();
    await big.page.locator(".show-main").click();
    const sent = await big.page.evaluate(() =>
      window.__calls.filter(([c]) => c === "plugin:event|emit").map(([, a]) => [a.event, a.payload]),
    );
    assert.deepEqual(sent, [["show-date", "2026-10-16"]]);
    await big.context.close();

    const small = await openApp(browser, { files: { "daily/2026-10-16.md": "- [ ] 치과\n" } });
    await small.page.evaluate(() => window.__emit("show-date", "2026-10-16"));
    await small.page.clock.runFor(10);
    assert.equal(await small.page.locator(".datebar .date").textContent(), "10월 16일 (금)");
    assert.deepEqual(await texts(small.page, "today"), ["치과"]);
    await small.context.close();
  });

  await scenario("작은 창의 달력 버튼과 날짜 글자는 모아보기 창을 연다", async () => {
    const { page, context } = await openApp(browser);
    await page.locator('[aria-label="모아보기"]').click();
    await page.locator(".datebar .date").click();
    const calls = await page.evaluate(() => window.__calls.filter(([c]) => c === "open_overview").length);
    assert.equal(calls, 2);
    await context.close();
  });

  await scenario("작은 창이 보던 날짜를 붙여 열면(#overview?date=) 달력이 뜨고 그 날짜가 골라져 있다", async () => {
    const { page, context, errors } = await openApp(browser, {
      hash: "#overview?date=2026-10-13",
      viewport: { width: 1180, height: 760 },
      files: { "daily/2026-10-13.md": "- [ ] 어제 일\n" },
    });
    assert.equal(await page.locator(".calendar").count(), 1, "달력이 아니라 작은 창 화면이 떴다");
    assert.equal((await page.locator(".side-date").textContent()).trim(), "10월 13일 (화)");
    assert.deepEqual(await texts(page, "overview"), ["어제 일"]);
    assert.deepEqual(errors, []);
    await context.close();
  });

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

  await scenario("오른쪽 아래에 언젠가 목록이 보이고, 여기서 추가하면 someday.md에 저장된다", async () => {
    const { page, context, errors } = await openApp(browser, { ...BIG, files: { "someday.md": "- [ ] 여권 갱신\n" } });
    assert.deepEqual(await texts(page, "someday"), ["여권 갱신"]);
    const input = page.locator('[data-list="someday"] .add input');
    await input.fill("책상 정리");
    await input.press("Enter");
    await page.clock.runFor(10);
    assert.equal((await fs(page))["someday.md"], "- [ ] 여권 갱신\n- [ ] 책상 정리\n");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("언젠가 항목을 달력 날짜 칸에 끌어다 놓으면 그 날짜로 옮겨진다", async () => {
    const { page, context } = await openApp(browser, {
      ...BIG,
      files: { "someday.md": "- [ ] 여권 갱신\n- [ ] 책상 정리\n", "daily/2026-10-20.md": "- [ ] 보고서\n" },
    });
    await dragTo(page, '[data-list="someday"] .item >> nth=0', '.cell[data-date="2026-10-20"]');
    const files = await fs(page);
    assert.equal(files["someday.md"], "- [ ] 책상 정리\n");
    assert.equal(files["daily/2026-10-20.md"], "- [ ] 보고서\n- [ ] 여권 갱신\n");
    assert.deepEqual(await cellTexts(page, "2026-10-20"), ["보고서", "여권 갱신"]);
    await context.close();
  });

  await scenario("언젠가 항목을 고른 날짜 칸이나 위쪽 목록에 놓으면 오른쪽 위 목록으로 들어간다", async () => {
    const { page, context } = await openApp(browser, {
      ...BIG,
      files: { "someday.md": "- [ ] 여권 갱신\n- [ ] 책상 정리\n", "daily/2026-10-14.md": "- [ ] 오늘 일\n" },
    });
    await dragTo(page, '[data-list="someday"] .item >> nth=0', '.cell[data-date="2026-10-14"]');
    assert.deepEqual(await texts(page, "overview"), ["오늘 일", "여권 갱신"]);
    await dragTo(page, '[data-list="someday"] .item >> nth=0', '[data-list="overview"] .add');
    assert.deepEqual(await texts(page, "overview"), ["오늘 일", "여권 갱신", "책상 정리"]);
    assert.deepEqual(await texts(page, "someday"), []);
    const files = await fs(page);
    assert.equal(files["daily/2026-10-14.md"], "- [ ] 오늘 일\n- [ ] 여권 갱신\n- [ ] 책상 정리\n");
    assert.equal(files["someday.md"], undefined);
    await context.close();
  });

  await scenario("날짜 할 일을 언젠가로 내리거나 다른 날짜 칸으로 옮길 수 있다", async () => {
    const { page, context } = await openApp(browser, {
      ...BIG,
      files: { "daily/2026-10-14.md": "- [ ] 하나\n- [ ] 둘\n" },
    });
    await dragTo(page, '[data-list="overview"] .item >> nth=0', '[data-list="someday"] .add');
    await dragTo(page, '[data-list="overview"] .item >> nth=0', '.cell[data-date="2026-10-16"]');
    const files = await fs(page);
    assert.equal(files["someday.md"], "- [ ] 하나\n");
    assert.equal(files["daily/2026-10-16.md"], "- [ ] 둘\n");
    assert.equal(files["daily/2026-10-14.md"], undefined);
    await context.close();
  });

  await scenario("드래그 중 달력 칸 위에 있으면 그 칸이 표시되고, Esc로 취소하면 아무것도 안 옮겨진다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, files: { "someday.md": "- [ ] 여권 갱신\n" } });
    const from = page.locator('[data-list="someday"] .item').first();
    await from.hover();
    const grip = await from.locator(".grip").boundingBox();
    const cell = await page.locator('.cell[data-date="2026-10-20"]').boundingBox();
    await page.mouse.move(grip.x + 3, grip.y + 3);
    await page.mouse.down();
    await page.mouse.move(cell.x + 30, cell.y + 30, { steps: 8 });
    assert.ok(await page.locator('.cell[data-date="2026-10-20"]').evaluate((e) => e.classList.contains("drop-target")));
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "someday"), ["여권 갱신"]);
    assert.equal((await fs(page))["daily/2026-10-20.md"], undefined);
    await context.close();
  });

  await scenario("작은 창에서 언젠가를 고치면 모아보기 창도 다시 읽는다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, files: { "someday.md": "- [ ] 하나\n" } });
    await page.evaluate(() => {
      window.__setFile("someday.md", "- [ ] 하나\n- [ ] 작은 창에서 추가\n");
      window.__emit("file-changed", { path: "someday.md", source: "main" });
    });
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "someday"), ["하나", "작은 창에서 추가"]);
    await context.close();
  });
}
