// 버그 탐색에서 찾은 21건과 추가 기능(방향키 이동, Esc 드래그 취소)의 재발 방지 시나리오
import assert from "node:assert/strict";
import { fs, openApp, scenario, texts, caretToEnd } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
const BIG = { hash: "#overview", viewport: { width: 1180, height: 760 } };

async function dragGrip(page, fromSelector, toSelector) {
  const from = page.locator(fromSelector);
  await from.hover();
  const grip = await from.locator(".grip").boundingBox();
  const target = await page.locator(toSelector).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 2, { steps: 8 });
  await page.mouse.up();
}

export default async function (browser) {
  console.log("\n[목록 편집]");

  await scenario("B01 여러 줄 글을 붙여넣으면 화면과 파일이 같은 모양이어야 한다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    const text = page.locator('[data-list="today"] .item .text').first();
    await text.click();
    await caretToEnd(page);
    await page.evaluate(() => document.execCommand("insertText", false, "\n둘째 줄"));
    await page.clock.runFor(1100);
    const shown = await text.evaluate((e) => e.innerText);
    const saved = (await fs(page))[TODAY];
    assert.ok(!shown.includes("\n"), `화면은 두 줄(${JSON.stringify(shown)})인데 파일은 한 줄(${JSON.stringify(saved)})`);
    await context.close();
  });

  await scenario("B02 할 일 글자에 '<!-- from:날짜 -->'를 적어도 다시 켰을 때 글자가 그대로여야 한다", async () => {
    const { page, context } = await openApp(browser);
    const input = page.locator('[data-list="today"] .add input');
    await input.fill("주석 예시 <!-- from:2026-01-01 -->");
    await input.press("Enter");
    await page.clock.runFor(10);
    await page.reload();
    await page.waitForSelector(".foot");
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "today"), ["주석 예시 <!-- from:2026-01-01 -->"]);
    await context.close();
  });

  await scenario("B03 Enter로 만든 빈 항목을 그대로 두고 나가면 파일에 빈 할 일이 남지 않아야 한다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    await page.locator('[data-list="today"] .item .text').click();
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 하나\n");
    await context.close();
  });

  await scenario("B04 빈 할 일 줄('- [ ] ')의 끝 공백을 다른 편집기가 지워도 할 일로 읽어야 한다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n- [ ]\n- [ ] 셋\n" } });
    assert.deepEqual(await texts(page, "today"), ["하나", "", "셋"]);
    await context.close();
  });

  await scenario("B05 공백만 있는 글은 입력칸에서 추가되지 않고, 항목으로도 저장되지 않아야 한다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    const text = page.locator('[data-list="today"] .item .text');
    await text.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Meta+A");
    await page.keyboard.type("   ");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(10);
    const saved = (await fs(page))[TODAY] ?? "";
    assert.ok(!saved.includes("- [ ]    \n"), `공백 항목이 저장됨: ${JSON.stringify(saved)}`);
    await context.close();
  });

  await scenario("B07 방향키 ↑↓로 항목 사이를 오갈 수 있어야 한다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n- [ ] 둘\n" } });
    await page.locator('[data-list="today"] .item .text').first().click();
    await page.keyboard.press("ArrowDown");
    const idx = await page.evaluate(() =>
      [...document.querySelectorAll('[data-list="today"] .item .text')].indexOf(document.activeElement),
    );
    assert.equal(idx, 1, "↓ 를 눌러도 다음 항목으로 가지 않는다");
    await context.close();
  });

  await scenario("B08 Obsidian 하위 할 일(들여쓴 '  - [ ]')은 저장 후에도 원래 자리에 있어야 한다", async () => {
    const md = "- [ ] 상위\n  - [ ] 하위\n- [ ] 다음\n";
    const { page, context } = await openApp(browser, { files: { [TODAY]: md } });
    await page.locator('[data-list="today"] .item .box').last().click();
    await page.clock.runFor(10);
    const saved = (await fs(page))[TODAY];
    assert.ok(saved.startsWith("- [ ] 상위\n  - [ ] 하위\n"), `하위 할 일이 맨 아래 메모로 밀려남: ${JSON.stringify(saved)}`);
    await context.close();
  });

  console.log("\n[드래그·높이 조절]");

  await scenario("B09 모아보기 창의 ⋮⋮ 손잡이로도 순서를 바꿀 수 있어야 한다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, files: { [TODAY]: "- [ ] 하나\n- [ ] 둘\n" } });
    await dragGrip(page, '[data-list="overview"] .item >> nth=1', '[data-list="overview"] .item >> nth=0');
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "overview"), ["둘", "하나"], "손잡이가 보이지만 끌어도 아무 일도 없다");
    await context.close();
  });

  await scenario("B10 높이 조절 중 포인터가 취소되면(창 밖에서 손 뗌 등) 조절이 끝나야 한다", async () => {
    const { page, context } = await openApp(browser);
    const split = await page.locator(".split").boundingBox();
    await page.mouse.move(split.x + 100, split.y + 4);
    await page.mouse.down();
    await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel")));
    await page.mouse.move(split.x + 100, split.y - 150, { steps: 3 });
    const stuck = await page.evaluate(() => document.body.classList.contains("resizing"));
    assert.equal(stuck, false, "손을 뗀 뒤에도 마우스를 따라 높이가 계속 바뀐다");
    await page.mouse.up();
    await context.close();
  });

  await scenario("B11 드래그 중 포인터가 취소되면 드래그 상태가 풀려야 한다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n- [ ] 둘\n" } });
    const item = page.locator('[data-list="today"] .item').first();
    await item.hover();
    const grip = await item.locator(".grip").boundingBox();
    await page.mouse.move(grip.x + 3, grip.y + 3);
    await page.mouse.down();
    await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel")));
    const stuck = await page.evaluate(() => document.body.classList.contains("dragging"));
    assert.equal(stuck, false, "드래그 상태(반투명·손 모양 커서)가 남는다");
    await page.mouse.up();
    await context.close();
  });

  await scenario("B12 Esc를 누르면 드래그가 취소되어야 한다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n- [ ] 둘\n" } });
    const item = page.locator('[data-list="today"] .item').nth(1);
    await item.hover();
    const grip = await item.locator(".grip").boundingBox();
    const first = await page.locator('[data-list="today"] .item').first().boundingBox();
    await page.mouse.move(grip.x + 3, grip.y + 3);
    await page.mouse.down();
    await page.mouse.move(first.x + 40, first.y + 2, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.deepEqual(await texts(page, "today"), ["하나", "둘"], "Esc로 취소되지 않고 옮겨졌다");
    await context.close();
  });

  console.log("\n[저장]");

  await scenario("B13 저장에 실패하면 창을 벗어나지 않아도 잠시 뒤 스스로 다시 시도해야 한다", async () => {
    const { page, context } = await openApp(browser);
    await page.evaluate(() => (window.__failWrites = true));
    await page.locator('[data-list="today"] .add input').fill("장보기");
    await page.locator('[data-list="today"] .add input').press("Enter");
    await page.clock.runFor(10);
    await page.evaluate(() => (window.__failWrites = false));
    await page.clock.runFor(30_000);
    assert.equal((await fs(page))[TODAY], "- [ ] 장보기\n", "30초가 지나도 다시 저장하지 않는다");
    await context.close();
  });

  await scenario("B14 모아보기 창에서 고치던 중 메뉴 막대로 종료해도 그 내용이 저장되어야 한다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, files: { [TODAY]: "- [ ] 하나\n" } });
    await page.locator('[data-list="overview"] .item .text').click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.evaluate(() => window.__emit("quit-requested"));
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 하나!\n", "모아보기 창은 종료 신호를 듣지 않아 고친 내용이 사라진다");
    await context.close();
  });

  await scenario("B15 두 창이 같은 날짜를 1초 안에 각각 고치면 한쪽 수정이 사라지면 안 된다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, files: { [TODAY]: "- [ ] 하나\n" } });
    await page.locator('[data-list="overview"] .item .text').click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.evaluate((p) => {
      window.__setFile(p, "- [ ] 하나\n- [ ] 작은 창에서 추가\n");
      window.__emit("file-changed", { path: p, source: "main" });
    }, TODAY);
    await page.clock.runFor(1500);
    const saved = (await fs(page))[TODAY];
    assert.ok(saved.includes("작은 창에서 추가"), `작은 창에서 추가한 항목이 덮어써져 사라짐: ${JSON.stringify(saved)}`);
    await context.close();
  });

  await scenario("B16 앱을 처음 켜기만 했을 때는 '저장 대기 중'이 아니라 '저장됨'이어야 한다", async () => {
    const { page, context } = await openApp(browser);
    assert.equal(await page.locator(".status").textContent(), "저장됨");
    await context.close();
  });

  await scenario("B17 투명도 슬라이더를 한 번 움직이면 창 투명도 변경은 한 번만 요청해야 한다", async () => {
    const { page, context } = await openApp(browser);
    await page.evaluate(() => (window.__calls.length = 0));
    await page.locator('input[type="range"]').fill("50");
    await page.clock.runFor(10);
    const n = await page.evaluate(() => window.__calls.filter(([c]) => c === "set_window_opacity").length);
    assert.equal(n, 1, `한 번 움직였는데 ${n}번 요청한다`);
    await context.close();
  });

  console.log("\n[날짜·자정]");

  await scenario("B18 작은 창의 날짜 글자를 눌러 달력을 열면 보던 날짜가 선택돼 있어야 한다", async () => {
    const { page, context } = await openApp(browser);
    await page.locator('[aria-label="이전 날"]').click();
    await page.locator(".datebar .date").click();
    const args = await page.evaluate(() => window.__calls.filter(([c]) => c === "open_overview").map(([, a]) => a));
    assert.ok(JSON.stringify(args).includes("2026-10-13"), `보던 날짜(10/13)를 넘기지 않는다: ${JSON.stringify(args)}`);
    await context.close();
  });

  await scenario("B19 다음 날로 옮긴 뒤 비게 된 지난 날짜 파일은 빈 파일로 남지 않아야 한다", async () => {
    const { page, context } = await openApp(browser, {
      now: "2026-10-14T23:59:30",
      files: {
        "settings.json": JSON.stringify({ carryOver: "next-day", lastRolloverDate: "2026-10-14" }),
        [TODAY]: "- [ ] 미완료만\n",
      },
    });
    await page.clock.runFor(60_000);
    const files = await fs(page);
    assert.ok(files[TODAY] !== "", "내용 없는 빈 날짜 파일이 생긴다");
    await context.close();
  });

  await scenario("B20 설정 파일 값이 이상하면(높이 비율 5, 투명도 글자) 기본값으로 바로잡아야 한다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "settings.json": JSON.stringify({ splitRatio: 5, opacity: "abc" }) },
    });
    const ratio = await page.evaluate(() => {
      const t = document.querySelector(".today").getBoundingClientRect().height;
      const b = document.querySelector(".body").getBoundingClientRect().height;
      return t / b;
    });
    const calls = await page.evaluate(() => window.__calls.filter(([c]) => c === "set_window_opacity").map(([, a]) => a.alpha));
    assert.ok(ratio <= 0.81 && calls.every((a) => Number.isFinite(a) && a >= 0.2), `비율 ${ratio.toFixed(2)}, 투명도 요청 ${JSON.stringify(calls)}`);
    await context.close();
  });

  await scenario("B21 지난 날짜·예정 꼬리표가 있어도 최소 폭(260px)에서 날짜 막대가 넘치지 않아야 한다", async () => {
    const { page, context } = await openApp(browser, { viewport: { width: 260, height: 470 } });
    await page.locator('[aria-label="이전 날"]').click();
    await page.clock.runFor(10);
    const overflow = await page.locator(".datebar").evaluate((e) => e.scrollWidth - e.clientWidth);
    const today = await page.locator(".today-btn").boundingBox();
    assert.ok(overflow <= 0 && today.x + today.width <= 260, `날짜 막대가 ${overflow}px 넘친다`);
    await context.close();
  });

  await scenario("B22 자정 직후 모아보기 창의 '오늘' 표시도 바로 다음 날로 넘어가야 한다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, now: "2026-10-14T23:59:50" });
    await page.clock.runFor(15_000);
    const isToday = await page.locator('.cell[data-date="2026-10-15"]').evaluate((e) => e.classList.contains("today"));
    assert.ok(isToday, "자정이 지나고 15초가 지나도 어제를 오늘로 표시한다");
    await context.close();
  });

  await scenario("B23 모아보기 창에서 다른 달 날짜를 고른 뒤 '오늘'을 누르면 오른쪽 목록도 오늘로 돌아와야 한다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, files: { [TODAY]: "- [ ] 오늘 일\n" } });
    await page.locator('.cell[data-date="2026-11-01"]').click();
    await page.clock.runFor(10);
    await page.locator(".pill").click();
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "overview"), ["오늘 일"]);
    await context.close();
  });

  console.log("\n[모아보기]");

  await scenario("B24 모아보기 창에서 지난 날짜 칸을 고르면 그 날의 할 일이 칸과 오른쪽에 함께 보여야 한다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, files: { "daily/2026-10-02.md": "- [x] 지난 일\n" } });
    await page.locator('.cell[data-date="2026-10-02"]').click();
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "overview"), ["지난 일"]);
    assert.equal((await page.locator('.cell[data-date="2026-10-02"] .mi').count()), 1);
    await context.close();
  });

  await scenario("B25 모아보기 창에서 날짜를 바꾸는 순간 고치던 내용은 원래 날짜에 저장돼야 한다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, files: { [TODAY]: "- [ ] 하나\n" } });
    await page.locator('[data-list="overview"] .item .text').click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.locator('.cell[data-date="2026-10-20"]').click();
    await page.clock.runFor(10);
    const files = await fs(page);
    assert.equal(files[TODAY], "- [ ] 하나!\n");
    assert.equal(files["daily/2026-10-20.md"], undefined, "고치던 내용이 새로 고른 날짜 파일에 저장됐다");
    await context.close();
  });

  await scenario("B26 '작은 창에서 보기'를 누르면 작은 창이 숨겨져 있어도 앞으로 나와야 한다", async () => {
    const { page, context } = await openApp(browser);
    await page.evaluate(() => window.__emit("show-date", "2026-10-16"));
    await page.clock.runFor(10);
    const calls = await page.evaluate(() => window.__calls.map(([c]) => c));
    assert.ok(calls.includes("plugin:window|show") && calls.includes("plugin:window|set_focus"), `show/focus 요청: ${calls.filter((c) => c.startsWith("plugin:window")).join(", ")}`);
    await context.close();
  });
  console.log("\n[추가]");

  await scenario("B27 설정의 '마지막 처리 날짜'가 미래로 적혀 있어도(시계 변경·시차 있는 다른 컴퓨터와 동기화) 자정 처리가 멈추면 안 된다", async () => {
    const { page, context } = await openApp(browser, {
      now: "2026-10-14T23:59:30",
      files: {
        "settings.json": JSON.stringify({ carryOver: "next-day", lastRolloverDate: "2026-10-20" }),
        [TODAY]: "- [ ] 미완료\n",
      },
    });
    await page.clock.runFor(60_000);
    assert.deepEqual(await texts(page, "today"), ["미완료"], "미완료가 다음 날로 넘어오지 않는다");
    await context.close();
  });

  await scenario("B28 창을 클릭하지 않아도 다른 편집기에서 고친 내용이 잠시 뒤 보여야 한다 (항상 떠 있는 창)", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    await page.evaluate((p) => window.__setFile(p, "- [ ] 하나\n- [ ] Obsidian에서 추가\n"), TODAY);
    await page.clock.runFor(60_000);
    assert.deepEqual(await texts(page, "today"), ["하나", "Obsidian에서 추가"], "1분이 지나도 창을 클릭하기 전까지 반영되지 않는다");
    await context.close();
  });

  await scenario("B29 작은 창을 닫으면 앱이 꺼지지 않고 저장한 뒤 숨는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    await page.locator('[data-list="today"] .item .text').click();
    await caretToEnd(page);
    await page.keyboard.type("!");
    await page.evaluate(() => window.__emit("tauri://close-requested", null));
    await page.clock.runFor(10);
    const calls = await page.evaluate(() => window.__calls.map(([c]) => c));
    assert.equal((await fs(page))[TODAY], "- [ ] 하나!\n");
    assert.ok(calls.includes("plugin:window|hide"), "숨기지 않았다");
    assert.ok(!calls.includes("plugin:window|destroy"), "창을 없앴다");
    await context.close();
  });

  await scenario("B30 체크(즉시 저장) 직후 이어서 치는 글자가, 저장 완료 신호나 파일 다시 읽기에 덮여 사라지지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n- [ ] 둘\n" } });
    await page.locator('[data-list="today"] .item .box').first().click();
    await page.locator('[data-list="today"] .item .text').nth(1).click();
    await caretToEnd(page);
    await page.keyboard.type(" 추가");
    await page.clock.runFor(1);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.clock.runFor(16_000);
    // 체크한 "하나"는 1초 뒤 끝낸 일 쪽(아래)으로 옮겨진다
    assert.deepEqual(await texts(page, "today"), ["둘 추가", "하나"]);
    assert.equal((await fs(page))[TODAY], "- [ ] 둘 추가\n- [x] 하나\n");
    await context.close();
  });
}
