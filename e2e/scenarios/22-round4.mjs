// 라운드 4 QA(QA4-01~05)와 3차 코드 리뷰(M1·M2·L4·sync 메아리)에서 나온 경우들. QA4 시나리오를 옮기고 리뷰 항목을 더했다.
// 쓰기 지연(__writeDelay)·읽은 순간 내용(__snapRead)·쓰기마다 바뀌는 파일(__churn)은 모의 백엔드에 있다
import assert from "node:assert/strict";
import { calls, caretToEnd, fs, openApp, paste, scenario, setCaret, status, texts } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
const YESTERDAY = "daily/2026-10-13.md";
const TOMORROW = "daily/2026-10-15.md";
const J = JSON.stringify;
const QUICK = { hash: "#quick", viewport: { width: 620, height: 96 } };
const BIG = { hash: "#overview", viewport: { width: 1180, height: 760 } };
const ZW = "​";

const box = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .box`).nth(i);
const text = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .text`).nth(i);
const footText = async (page) => (await page.locator(".foot").textContent()).replace(/\s+/g, " ").trim();
const quickInput = (page) => page.locator(".quick input");
const quickHint = async (page) => (await page.locator(".quick .hint").textContent()).trim();
const placeholder = (page) => quickInput(page).getAttribute("placeholder");
const hides = async (page) => (await calls(page, "hide_quick")).length;
const count = (s, needle) => (s ?? "").split("\n").filter((l) => l.includes(needle)).length;
async function add(page, value, list = "today") {
  const input = page.locator(`[data-list="${list}"] .add input`);
  await input.fill(value);
  await input.press("Enter");
  await page.clock.runFor(10);
}
async function typeAtEnd(page, i, s, list = "today") {
  await text(page, i, list).click();
  await caretToEnd(page);
  await page.keyboard.type(s);
}

export default async function (browser) {
  // ── QA4-01: 날짜를 바꾸며 flush를 기다리는 동안의 편집 ──
  await scenario("QA4-01 쓰기가 느릴 때 고치고 ▶ 직후 아직 보이는 전날 목록에서 체크해도 다음 날 파일로 새지 않는다", async () => {
    const files = { [TODAY]: "- [ ] 오늘 a\n- [ ] 오늘 b\n", [TOMORROW]: "- [ ] 내일 x\n" };
    const { page, context } = await openApp(browser, { files, globals: { __writeDelay: 400 } });
    await page.clock.runFor(2400);
    await typeAtEnd(page, 0, " 고침");
    await page.locator('button[aria-label="다음 날"]').click();
    await page.clock.runFor(50);
    const visible = await texts(page, "today");
    if (visible.includes("오늘 b")) await box(page, visible.indexOf("오늘 b")).click();
    await page.clock.runFor(3000);
    const f = await fs(page);
    assert.equal(f[TOMORROW], "- [ ] 내일 x\n", "다음 날 파일에 전날 할 일이 들어감");
    assert.ok(f[TODAY].includes("오늘 a 고침"), "전날 고침이 사라짐");
    assert.deepEqual(await texts(page, "today"), ["내일 x"]);
    await context.close();
  });

  await scenario("QA4-01 ▶ 직후 전날 목록에 글자를 더 쳐도 그 글자는 전날 파일로 간다", async () => {
    const files = { [TODAY]: "- [ ] 오늘 a\n- [ ] 오늘 b\n", [TOMORROW]: "- [ ] 내일 x\n" };
    const { page, context } = await openApp(browser, { files, globals: { __writeDelay: 400 } });
    await page.clock.runFor(2400);
    await typeAtEnd(page, 1, "1");
    await page.locator('button[aria-label="다음 날"]').click();
    await page.clock.runFor(30);
    const visible = await texts(page, "today");
    if (visible.length && visible[0].startsWith("오늘")) {
      await text(page, 0).click();
      await page.keyboard.type("Z");
    }
    await page.clock.runFor(3000);
    const f = await fs(page);
    assert.equal(f[TOMORROW], "- [ ] 내일 x\n", "다음 날 파일에 전날 할 일이 들어감");
    assert.ok(f[TODAY].includes("오늘 b1"), "전날 고침이 사라짐: " + J(f[TODAY]));
    await context.close();
  });

  await scenario("QA4-01 모아보기: 다른 날을 누른 직후 아직 보이는 원래 목록에서 체크해도 새로 고른 날 파일·칸으로 새지 않는다", async () => {
    const files = { [TODAY]: "- [ ] 오늘 a\n- [ ] 오늘 b\n", [TOMORROW]: "- [ ] 내일 x\n" };
    const { page, context } = await openApp(browser, { ...BIG, files, globals: { __writeDelay: 400 } });
    await page.clock.runFor(500);
    await typeAtEnd(page, 0, " 고침", "overview");
    await page.locator(`[data-date="2026-10-15"]`).first().click();
    await page.clock.runFor(50);
    const visible = await texts(page, "overview");
    if (visible.includes("오늘 b")) await box(page, visible.indexOf("오늘 b"), "overview").click();
    await page.clock.runFor(3000);
    const f = await fs(page);
    assert.equal(f[TOMORROW], "- [ ] 내일 x\n", "다른 날 파일로 샘");
    assert.ok(f[TODAY].includes("오늘 a 고침"));
    const cell = await page.locator(`[data-date="2026-10-15"] .mi`).allTextContents();
    assert.ok(!cell.some((t) => t.includes("오늘")), "달력의 새 날 칸에 이전 날 할 일이 보임: " + J(cell));
    await context.close();
  });

  await scenario("저장(QA4 N02) 쓰는 동안 aru가 4번 끼어들어 합쳐 쓰고 계속 타이핑해도 글자·aru 줄이 모두 남고 화면=파일", async () => {
    const files = { [TODAY]: "- [ ] 장보기\n- [ ] 운동\n" };
    const { page, context } = await openApp(browser, { files, globals: { __writeDelay: 300 } });
    await page.clock.runFor(2400);
    await text(page, 1).click();
    await caretToEnd(page);
    for (let round = 0; round < 4; round++) {
      await page.evaluate(([p, r]) => ((window.__interleave ||= {})[p] = window.__mockFs[p] + `- [ ] aru${r} <!-- ai:codex@1792000000 -->\n`), [TODAY, round]);
      await page.keyboard.type(`${round}`);
      await page.clock.runFor(1050);
      await page.keyboard.type("a");
      await page.clock.runFor(350);
      await page.keyboard.type("b");
      await page.clock.runFor(1500);
    }
    await page.clock.runFor(4000);
    const f = await fs(page);
    for (let r = 0; r < 4; r++) assert.ok(f[TODAY].includes(`aru${r}`), `aru${r} 줄이 사라짐`);
    assert.ok(f[TODAY].includes("- [ ] 운동0ab1ab2ab3ab\n"), "타이핑이 사라지거나 쪼개짐: " + J(f[TODAY]));
    assert.equal(count(f[TODAY], "운동"), 1, "운동 줄이 둘");
    assert.equal((await texts(page, "today")).filter((t) => t.startsWith("aru")).length, 4);
    await context.close();
  });

  await scenario("저장(QA4 N03) 쓰기마다 다른 곳이 파일을 바꿔(6번 연속) 합치기 상한을 넘겨도 5초 뒤 다시 써서 모두 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    await page.clock.runFor(2400);
    await page.evaluate((p) => (window.__churn = { [p]: 6 }), TODAY);
    await typeAtEnd(page, 0, " 고침");
    await page.clock.runFor(1200);
    await page.clock.runFor(10_000);
    const f = await fs(page);
    assert.ok(f[TODAY].includes("- [ ] 하나 고침\n"));
    for (let i = 1; i <= 6; i++) assert.ok(f[TODAY].includes(`바깥${i}\n`), `바깥${i} 사라짐`);
    assert.equal(await status(page), "저장됨");
    assert.deepEqual(await texts(page, "today"), f[TODAY].trim().split("\n").map((l) => l.replace(/^- \[.\] /, "")));
    await context.close();
  });

  await scenario("저장(QA4 N04) 날짜를 빠르게 ◀▶▶ 오가며 매번 고쳐도(쓰기 0.2초) 각 날 파일에 제 고침만 들어간다", async () => {
    const files = { [YESTERDAY]: "- [ ] 어제 일\n", [TODAY]: "- [ ] 오늘 일\n", [TOMORROW]: "- [ ] 내일 일\n", "settings.json": '{"carryOver":"keep"}' };
    const { page, context } = await openApp(browser, { files, globals: { __writeDelay: 200 } });
    await page.clock.runFor(2400);
    await typeAtEnd(page, 0, "A");
    await page.locator('button[aria-label="이전 날"]').click();
    await page.clock.runFor(600);
    await typeAtEnd(page, 0, "B");
    await page.locator('button[aria-label="다음 날"]').click();
    await page.locator('button[aria-label="다음 날"]').click();
    await page.clock.runFor(900);
    await typeAtEnd(page, 0, "C");
    await page.clock.runFor(3000);
    const f = await fs(page);
    assert.equal(f[YESTERDAY], "- [ ] 어제 일B\n");
    assert.equal(f[TODAY], "- [ ] 오늘 일A\n");
    assert.equal(f[TOMORROW], "- [ ] 내일 일C\n");
    await context.close();
  });

  await scenario("저장(QA4 N05) 쓰기가 느린 중 창을 닫으면 충돌로 합쳐 다시 쓰는 것까지 끝낸 뒤 숨는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" }, globals: { __writeDelay: 300 } });
    await page.clock.runFor(2400);
    await typeAtEnd(page, 0, "!");
    await page.evaluate((p) => ((window.__interleave ||= {})[p] = "- [ ] 하나\n- [ ] aru 줄\n"), TODAY);
    await page.evaluate(() => window.__emit("tauri://close-requested", {}));
    await page.clock.runFor(2000);
    assert.equal((await fs(page))[TODAY], "- [ ] 하나!\n- [ ] aru 줄\n");
    await context.close();
  });

  // ── 리뷰 M1·M2·sync 메아리 ──
  await scenario("리뷰 M1 aru가 끼어들어 합친 쓰기가 실패하고 곧바로 창을 벗어나 다시 써도, 다음 편집이 aru 줄을 지우지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    await page.clock.runFor(2400);
    await page.evaluate((p) => {
      (window.__interleave ||= {})[p] = "- [ ] 하나\n- [ ] aru 줄\n";
      let n = 0;
      // 첫 시도는 충돌, 합친 내용을 쓰는 두 번째 시도는 잠금 초과로 실패
      window.__beforeWrite = () => {
        if (++n === 2) throw "LOCKED: 저장 폴더가 잠겨 있어요(모의)";
      };
    }, TODAY);
    await typeAtEnd(page, 0, " 고침");
    await page.clock.runFor(1100);
    assert.equal(await status(page), "저장 실패 — 다시 시도합니다");
    // 3초 다시 읽기보다 먼저 창을 벗어나 flush가 재시도한다
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(50);
    assert.equal((await fs(page))[TODAY], "- [ ] 하나 고침\n- [ ] aru 줄\n");
    await typeAtEnd(page, 0, "!");
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] 하나 고침!\n- [ ] aru 줄\n");
    assert.deepEqual(await texts(page, "today"), ["하나 고침!", "aru 줄"]);
    await context.close();
  });

  // 라운드 5(리뷰 N6): 상한을 넘긴 것은 실패가 아니라 늦어짐으로 보인다
  await scenario("리뷰 M2 응답이 오지 않는 쓰기가 있어도 날짜 이동은 10초 뒤 끝나고 저장이 늦어진다고 보인다", async () => {
    const files = { [TODAY]: "- [ ] 오늘\n", [TOMORROW]: "- [ ] 내일\n" };
    const { page, context } = await openApp(browser, { files });
    await page.clock.runFor(2400);
    await page.evaluate(() => (window.__hangWrites = true));
    await typeAtEnd(page, 0, "!");
    await page.clock.runFor(1100);
    await page.locator('button[aria-label="다음 날"]').click();
    await page.clock.runFor(5000);
    assert.notDeepEqual(await texts(page, "today"), ["내일"], "아직 기다려야 할 때 넘어감");
    await page.clock.runFor(5500);
    assert.deepEqual(await texts(page, "today"), ["내일"], "날짜 이동이 끝나지 않음");
    assert.equal(await status(page), "저장이 늦어지고 있어요…");
    await context.close();
  });

  await scenario("리뷰 질문(sync 메아리) 읽기가 내 쓰기 응답보다 먼저 와도 같은 줄이 둘이 되지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] a\n" }, globals: { __writeDelay: 600 } });
    await page.clock.runFor(2400);
    // 파일에는 쓰기를 시작하자마자 들어가고 응답은 0.6초 뒤에 온다. 그 사이 파일 변경 알림으로 다시 읽는다
    await page.evaluate(() => {
      window.__beforeWrite = (args) => window.__setFile(args.path, args.content);
    });
    await typeAtEnd(page, 0, "b");
    await page.clock.runFor(1000);
    await page.evaluate(() => (window.__beforeWrite = null));
    await page.keyboard.type("c");
    await page.clock.runFor(50);
    await page.evaluate((path) => window.__emit("file-changed", { path, source: "cli" }), TODAY);
    await page.clock.runFor(6000);
    const f = (await fs(page))[TODAY];
    assert.equal(f, "- [ ] abc\n");
    assert.deepEqual(await texts(page, "today"), ["abc"]);
    await context.close();
  });

  // ── 자정 정리(QA4 R01·R03~R06, 통과하던 것을 고정) ──
  await scenario("정리(QA4 R01) '언젠가로', 폴더가 늦게 붙을 때 어제 화면을 보고 있었으면 미완료는 언젠가로 한 번만, 어제엔 끝낸 일만", async () => {
    const files = {
      "settings.json": J({ carryOver: "someday", lastRolloverDate: "2026-10-13" }),
      [YESTERDAY]: "- [ ] 어제 미완료\n- [x] 어제 끝냄\n",
      "someday.md": "- [ ] 언젠가 원래\n",
    };
    const { page, context } = await openApp(browser, { files, rootUnavailable: true });
    await page.locator('button[aria-label="이전 날"]').click();
    await page.clock.runFor(50);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(4800);
    const f = await fs(page);
    assert.equal(count(f["someday.md"], "어제 미완료"), 1);
    assert.equal(f[YESTERDAY], "- [x] 어제 끝냄\n");
    assert.deepEqual(await texts(page, "today"), ["어제 끝냄"]);
    assert.ok((await texts(page, "someday")).includes("어제 미완료"));
    await context.close();
  });

  await scenario("정리(QA4 R03) 정리가 도는 동안(읽기 0.2초) 오늘 할 일을 계속 쳐도 글자가 빠지지 않고 옮겨 온 일은 하나", async () => {
    const files = {
      "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-13" }),
      [YESTERDAY]: "- [ ] 어제 미완료\n",
      [TODAY]: "- [ ] 오늘 원래\n",
    };
    const { page, context } = await openApp(browser, { files, rootUnavailable: true, globals: { __readDelay: 200 } });
    await page.clock.runFor(800);
    await add(page, "새로 적음");
    await page.clock.runFor(300);
    await page.evaluate(() => window.__setRootAvailable(true));
    const n = (await texts(page, "today")).length;
    await text(page, n - 1).click();
    await caretToEnd(page);
    for (const ch of "가나다라마바사아자차") {
      await page.keyboard.type(ch);
      await page.clock.runFor(150);
    }
    await page.clock.runFor(4000);
    const f = await fs(page);
    assert.equal(count(f[TODAY], "어제 미완료"), 1);
    assert.ok(f[TODAY].includes("새로 적음가나다라마바사아자차"), "글자 빠짐");
    assert.equal(count(f[TODAY], "새로 적음"), 1);
    assert.equal(f[YESTERDAY] ?? "", "");
    assert.deepEqual(await texts(page, "today"), f[TODAY].trim().split("\n").map((l) => l.replace(/^- \[.\] /, "").replace(/ <!--.*-->$/, "")));
    await context.close();
  });

  await scenario("정리(QA4 R04) 다른 날을 보는 중 정리하다 aru가 오늘 파일을 바꿔도 그 줄과 옮긴 일이 모두 남는다", async () => {
    const files = {
      "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-13" }),
      [YESTERDAY]: "- [ ] 어제 미완료\n",
      [TODAY]: "- [ ] 오늘 원래\n",
      [TOMORROW]: "- [ ] 내일\n",
    };
    const { page, context } = await openApp(browser, { files, rootUnavailable: true });
    await page.locator('button[aria-label="다음 날"]').click();
    await page.clock.runFor(50);
    await page.evaluate((p) => ((window.__interleave ||= {})[p] = "- [ ] 오늘 원래\n- [ ] aru 추가\n"), TODAY);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(4800);
    const f = await fs(page);
    assert.ok(f[TODAY].includes("aru 추가") && f[TODAY].includes("어제 미완료") && f[TODAY].includes("오늘 원래"), J(f[TODAY]));
    await context.close();
  });

  await scenario("정리(QA4 R05) 어제 화면을 읽는 중(읽은 순간 내용, 0.4초)에 정리가 돌아도 옮긴 일이 되살아나지 않는다", async () => {
    const files = {
      "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-13" }),
      [YESTERDAY]: "- [ ] 어제 미완료\n- [x] 어제 끝냄\n",
      [TODAY]: "- [ ] 오늘 원래\n",
    };
    const { page, context } = await openApp(browser, { files, rootUnavailable: true, globals: { __readDelay: 400, __snapRead: true } });
    await page.clock.runFor(100);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(2700);
    await page.locator('button[aria-label="이전 날"]').click();
    await page.clock.runFor(4000);
    const shown = await texts(page, "today");
    const i = shown.indexOf("어제 끝냄");
    if (i >= 0) await box(page, i).click();
    await page.clock.runFor(2000);
    const f = await fs(page);
    assert.equal(count(f[YESTERDAY], "어제 미완료") + count(f[TODAY], "어제 미완료"), 1, "어제 미완료가 둘이거나 없음");
    await context.close();
  });

  await scenario("정리(QA4 R06) 오늘 화면을 읽는 중에 정리가 오늘 파일에 바로 써도 화면=파일이고 다음 편집이 옮긴 일을 지우지 않는다", async () => {
    const files = {
      "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-13" }),
      [YESTERDAY]: "- [ ] 어제 미완료\n",
      [TODAY]: "- [ ] 오늘 원래\n",
    };
    const { page, context } = await openApp(browser, { files, rootUnavailable: true, globals: { __readDelay: 400, __snapRead: true, __writeDelay: 100 } });
    await page.locator('button[aria-label="이전 날"]').click();
    await page.clock.runFor(100);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(2700);
    await page.locator(".today-btn").click();
    await page.clock.runFor(4000);
    await typeAtEnd(page, 0, "!");
    await page.clock.runFor(2000);
    assert.equal(count((await fs(page))[TODAY], "어제 미완료"), 1);
    await context.close();
  });

  // ── QA4-05: 안내와 저장 실패 ──
  await scenario("QA4-05 '옮기지 않았어요' 안내가 떠 있는 동안 저장이 실패하면 저장 실패가 보이고 점은 빨간색이다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" }, session: { "aru.folderKept": "kept" } });
    await page.clock.runFor(300);
    assert.ok((await footText(page)).includes("이미 할 일이 있는 폴더"));
    assert.ok((await page.locator(".foot .dot").getAttribute("class")).includes("info"), "안내인데 점이 오류 색");
    await page.evaluate(() => (window.__failWrites = true));
    await typeAtEnd(page, 0, "!");
    await page.clock.runFor(1500);
    assert.ok((await footText(page)).includes("저장 실패"), "저장 실패가 안내에 가려짐");
    assert.ok((await page.locator(".foot .dot").getAttribute("class")).includes("error"));
    await context.close();
  });

  await scenario("QA4-05 안내가 떠 있는 동안 폴더를 열 수 없으면 그 경고가 먼저다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" }, session: { "aru.folderKept": "kept" } });
    await page.clock.runFor(300);
    await page.evaluate(() => window.__setRootAvailable(false));
    await page.clock.runFor(3200);
    assert.ok((await footText(page)).includes("저장 폴더를 열 수 없어요"));
    await context.close();
  });

  await scenario("안내(QA4 C1) 폴더를 열 수 없는 동안 적고 새 폴더를 고르면(sourceUnavailable) 새 폴더 파일과 합치고 새로고침 뒤 이유를 알린다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [TODAY]: "- [ ] 옛 폴더 일\n" },
      rootUnavailable: true,
      globals: { __setRootEmits: true, __pickResult: "/Volumes/새디스크/aru", __setRootCopied: false, __setRootReason: "sourceUnavailable" },
    });
    await page.clock.runFor(300);
    await add(page, "폴더 없을 때 적음");
    await page.clock.runFor(1200);
    await page.evaluate((p) => {
      window.__setRootAvailable(true);
      window.__setFile(p, "- [ ] 새 폴더 일\n");
    }, TODAY);
    await page.locator('[data-action="repick-folder"]').click();
    await page.clock.runFor(300);
    await page.waitForSelector(".foot");
    await page.clock.runFor(300);
    const f = await fs(page);
    assert.ok(f[TODAY].includes("새 폴더 일") && f[TODAY].includes("폴더 없을 때 적음"), "합치지 않음");
    assert.ok(!f[TODAY].includes("옛 폴더 일"));
    assert.ok((await footText(page)).includes("이전 폴더를 열 수 없어"));
    await context.close();
  });

  await scenario("안내(QA4 C3) 가장 작은 창(260×300)에서 안내와 AI 알림이 함께 떠도 넘치지 않고 전문은 title로 본다", async () => {
    const { page, context } = await openApp(browser, { viewport: { width: 260, height: 300 }, files: { [TODAY]: "- [ ] 하나\n" }, session: { "aru.folderKept": "sourceUnavailable" } });
    const now = await page.evaluate(() => Math.floor(Date.now() / 1000));
    await page.evaluate(([p, n]) => window.__setFile(p, `- [ ] 하나\n- [ ] AI 일 <!-- ai:claude-code@${n} -->\n`), [TODAY, now]);
    await page.clock.runFor(3200);
    const o = await page.evaluate(() => {
      const foot = document.querySelector(".foot");
      return { foot: foot.scrollWidth - foot.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    assert.ok(o.foot <= 0 && o.doc <= 0, "가로 넘침 " + J(o));
    assert.ok(((await page.locator(".foot .status").getAttribute("title")) ?? "").includes("이전 폴더를 열 수 없어"));
    await context.close();
  });

  await scenario("안내(QA4 C4) 모아보기에서도 '옮기지 않았어요' 안내가 보이고 10초 뒤 사라진다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, files: { [TODAY]: "- [ ] 하나\n" }, session: { "aru.folderKept": "kept" } });
    await page.clock.runFor(300);
    assert.ok((await footText(page)).includes("이미 할 일이 있는 폴더"));
    await page.clock.runFor(10_500);
    assert.ok(!(await footText(page)).includes("이미 할 일이"));
    await context.close();
  });

  // ── 빠른 입력(QA4-02·03, 리뷰 L4) ──
  await scenario("QA4-02 언젠가(Tab)로 적다 저장 실패 → 닫힘 → 다시 띄우면 글과 함께 언젠가도 남아 Enter가 언젠가로 넣는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n", "someday.md": "- [ ] 언젠가 원래\n" }, rootUnavailable: true });
    await page.keyboard.type("언젠가 갈 곳");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    assert.equal(await quickHint(page), "저장 폴더를 열 수 없어요");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(50);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(50);
    assert.equal(await placeholder(page), "언젠가 할 일 추가");
    await page.keyboard.press("Enter");
    await page.clock.runFor(400);
    const f = await fs(page);
    assert.equal(f["someday.md"], "- [ ] 언젠가 갈 곳\n- [ ] 언젠가 원래\n");
    assert.equal(f[TODAY], "- [ ] 원래\n");
    await context.close();
  });

  await scenario("QA4-02 언젠가로 Enter → 저장 중 다시 띄움 → 앞 저장 실패로 글이 빈 새 창에 돌아오면 대상도 언젠가다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 300 } });
    await page.keyboard.type("나중 일");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
    await page.evaluate(() => (window.__failWrites = true));
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(500);
    assert.equal(await quickInput(page).inputValue(), "나중 일");
    assert.equal(await placeholder(page), "언젠가 할 일 추가");
    assert.equal(await quickHint(page), "저장하지 못했어요");
    await page.evaluate(() => (window.__failWrites = false));
    await page.keyboard.press("Enter");
    await page.clock.runFor(800);
    assert.equal((await fs(page))["someday.md"], "- [ ] 나중 일\n");
    await context.close();
  });

  // 규칙: 앞 창의 저장이 실패했을 때 새 창 칸에 다른 글이 있으면 그 글은 건드리지 않고, 앞 글은 "저장하지 못한 앞 글이 있어요"로
  // 알린 뒤 들고 있다가 칸이 비는 다음 순간(지금 글을 넣은 직후, 또는 남긴 글 없이 다시 띄울 때) 칸에 고른 대상째 되돌린다
  await scenario("QA4-03 앞 창 저장이 실패할 때 새 창에서 다른 글을 쓰는 중이면 앞 글을 알리고, 지금 글을 넣은 뒤 칸에 되돌린다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400 } });
    await page.keyboard.type("첫 번째");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
    await page.evaluate(() => (window.__failWrites = true));
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(20);
    await page.keyboard.type("두 번째");
    await page.clock.runFor(400);
    assert.equal(await quickInput(page).inputValue(), "두 번째", "새 글을 건드림");
    assert.equal(await quickHint(page), "저장하지 못한 앞 글이 있어요: 첫 번째");
    await page.evaluate(() => (window.__failWrites = false));
    await page.keyboard.press("Enter");
    await page.clock.runFor(500);
    assert.equal(await quickInput(page).inputValue(), "첫 번째", "앞 글이 돌아오지 않음");
    assert.equal(await placeholder(page), "언젠가 할 일 추가", "앞 글이 고른 대상을 잃음");
    assert.equal(await quickHint(page), "앞서 넣으려던 글을 저장하지 못했어요");
    assert.equal(await hides(page), 0);
    await page.keyboard.press("Enter");
    await page.clock.runFor(500);
    const f = await fs(page);
    assert.equal(f[TODAY], "- [ ] 두 번째\n- [ ] 원래\n");
    assert.equal(f["someday.md"], "- [ ] 첫 번째\n");
    await context.close();
  });

  await scenario("QA4-03 새 창의 저장도 실패하면 새 글을 남기고, 다시 띄워 그 글을 넣으면 앞 글이 이어서 돌아온다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400 } });
    await page.keyboard.type("첫 번째");
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(20);
    await page.keyboard.type("두 번째");
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
    await page.evaluate(() => (window.__failWrites = true));
    await page.clock.runFor(200);
    assert.equal(await quickHint(page), "저장하지 못한 앞 글이 있어요: 첫 번째");
    await page.clock.runFor(800);
    assert.equal(await quickInput(page).inputValue(), "두 번째");
    assert.equal(await quickHint(page), "저장하지 못했어요 · 앞 글도 남아 있어요");
    await page.evaluate(() => (window.__failWrites = false));
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(50);
    assert.equal(await quickInput(page).inputValue(), "두 번째");
    await page.keyboard.press("Enter");
    await page.clock.runFor(800);
    assert.equal(await quickInput(page).inputValue(), "첫 번째");
    await page.keyboard.press("Enter");
    await page.clock.runFor(800);
    assert.equal((await fs(page))[TODAY], "- [ ] 첫 번째\n- [ ] 두 번째\n- [ ] 원래\n");
    await context.close();
  });

  await scenario("QA4-03 칸을 비운 채 닫혀 있었으면 다음에 띄울 때 못 넣은 앞 글을 칸에 되돌린다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" }, globals: { __readDelay: 400 } });
    await page.keyboard.type("첫 번째");
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
    await page.evaluate(() => (window.__failWrites = true));
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(20);
    await page.keyboard.type("두");
    await page.clock.runFor(400);
    // 새 글을 지우고 Esc로 닫는다
    await quickInput(page).fill("");
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window.__failWrites = false));
    await page.evaluate(() => window.__emit("quick-shown"));
    await page.clock.runFor(50);
    assert.equal(await quickInput(page).inputValue(), "첫 번째");
    assert.equal(await quickHint(page), "앞서 넣으려던 글을 저장하지 못했어요");
    await context.close();
  });

  // 규칙(리뷰 L4): 쓰는 동안 이어 친 글이 방금 넣은 글로 시작하면 이어 친 부분만 남긴다
  await scenario("리뷰 L4 느린 저장 중 '우유' Enter 뒤 '빵'을 치면 칸에는 '빵'만 남고, 다시 Enter하면 '우유빵' 없이 둘이 들어간다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "" }, globals: { __readDelay: 300 } });
    await page.keyboard.type("우유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(60);
    await page.keyboard.type("빵");
    await page.keyboard.press("Enter");
    await page.clock.runFor(800);
    assert.equal((await fs(page))[TODAY], "- [ ] 우유\n");
    assert.equal(await quickInput(page).inputValue(), "빵");
    assert.equal(await hides(page), 0);
    await page.keyboard.press("Enter");
    await page.clock.runFor(800);
    assert.equal((await fs(page))[TODAY], "- [ ] 빵\n- [ ] 우유\n");
    await context.close();
  });

  await scenario("리뷰 L4 이어 친 것이 띄어쓰기뿐이면 넣은 뒤 평소처럼 닫는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "" }, globals: { __readDelay: 300 } });
    await page.keyboard.type("우유");
    await page.keyboard.press("Enter");
    await page.clock.runFor(60);
    await page.keyboard.type(" ");
    await page.clock.runFor(800);
    assert.equal((await fs(page))[TODAY], "- [ ] 우유\n");
    assert.equal(await hides(page), 1);
    await context.close();
  });

  await scenario("빠른 입력(QA4 Q5) 저장 중 다른 곳을 눌렀는데 실패하면 창을 닫지 않고 실패를 알린다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "" }, globals: { __readDelay: 300 } });
    await page.keyboard.type("회의");
    await page.keyboard.press("Enter");
    await page.clock.runFor(50);
    await page.evaluate(() => {
      window.__failWrites = true;
      window.dispatchEvent(new Event("blur"));
    });
    await page.clock.runFor(800);
    assert.equal(await hides(page), 0);
    assert.equal(await quickHint(page), "저장하지 못했어요");
    await context.close();
  });

  // ── QA4-04: 보이지 않는 글자만 있는 할 일 ──
  await scenario("QA4-04 빠른 입력: 한글 채움(U+3164)·점자 빈칸(U+2800)·초성 채움(U+115F)·LRM만 쓴 글은 넣지 않는다", async () => {
    const { page, context } = await openApp(browser, { ...QUICK, files: { [TODAY]: "- [ ] 원래\n" } });
    for (const value of ["ㅤ", "⠀", "ᅟ", "‎", "ㅤㅤ ", "︀"]) {
      await page.evaluate(() => window.__emit("quick-shown"));
      await page.clock.runFor(10);
      await quickInput(page).fill(value);
      await quickInput(page).press("Enter");
      await page.clock.runFor(400);
    }
    assert.equal((await fs(page))[TODAY], "- [ ] 원래\n");
    await context.close();
  });

  await scenario("QA4-04 여러 줄 붙여넣기 중 보이지 않는 글자만 있는 줄은 할 일이 되지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    await text(page, 0).click();
    await caretToEnd(page);
    await paste(text(page, 0), `\n${ZW}\n둘\n⁠‍\nㅤ\n`);
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] 하나\n- [ ] 둘\n");
    assert.deepEqual(await texts(page, "today"), ["하나", "둘"]);
    await context.close();
  });

  await scenario("QA4-04 있는 할 일을 폭 0 공백만 남기고 지우면 파일에 쓰지 않고 체크도 되지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n- [ ] 둘\n" } });
    await text(page, 0).click();
    await page.evaluate((zw) => {
      const el = document.activeElement;
      el.textContent = zw;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }, ZW);
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] 둘\n");
    await box(page, 0).click();
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] 둘\n");
    assert.equal(await box(page, 0).getAttribute("aria-checked"), "false");
    await context.close();
  });

  await scenario("QA4-04 Enter로 나눌 때 커서 뒤가 폭 0 공백뿐이면 새 할 일은 빈 할 일이다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: `- [ ] 하나${ZW}\n` } });
    await text(page, 0).click();
    await setCaret(page, 2);
    await page.keyboard.press("Enter");
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] 하나\n");
    assert.deepEqual(await texts(page, "today"), ["하나", ""]);
    await context.close();
  });

  await scenario("QA4-04 이모지 속 ZWJ·변이 선택자는 글자 일부라 그대로 남는다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "" } });
    await add(page, "가족 👨‍👩‍👧 ❤️");
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] 가족 👨‍👩‍👧 ❤️\n");
    await context.close();
  });

  await scenario("AI(QA4 L4) AI 할 일 둘 중 하위 줄이 있는 것만 남기고 되돌린다", async () => {
    const now = Math.floor(new Date("2026-10-14T10:00:00").getTime() / 1000);
    const files = { [TODAY]: `- [ ] 원래\n- [ ] AI 하나 <!-- ai:codex@${now} -->\n  - 내 메모\n- [ ] AI 둘 <!-- ai:codex@${now} -->\n` };
    const { page, context } = await openApp(browser, { files });
    await page.clock.runFor(500);
    await page.locator('[data-action="undo-ai"]').click();
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[TODAY], "- [ ] 원래\n- [ ] AI 하나\n  - 내 메모\n");
    await context.close();
  });

  // ── 앱스토어판 화면(QA4 F1~F4): 업데이트·라이선스 흔적 없음, 넘침·콘솔 오류 없음 ──
  for (const [w, h] of [[260, 300], [320, 470]]) {
    await scenario(`화면(QA4 F1) ${w}×${h} 설정: 가로로 넘치지 않고 버전만 보이며 업데이트·라이선스 흔적이 없다`, async () => {
      const { page, context, errors } = await openApp(browser, { viewport: { width: w, height: h }, files: { [TODAY]: "- [ ] 하나\n" } });
      await page.locator('button[aria-label*="설정"], .titlebar button[title*="설정"]').first().click();
      await page.clock.runFor(300);
      const body = await page.locator(".settings-body").evaluate((e) => ({ text: e.innerText, sw: e.scrollWidth, cw: e.clientWidth }));
      assert.ok(body.sw <= body.cw, "설정 가로 넘침");
      assert.ok(body.text.includes("Aru 0.2.1"), "버전이 안 보임");
      assert.ok(!/라이선스|체험|구매|업데이트/.test(body.text), "흔적: " + body.text);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  await scenario("화면(QA4 F3) 모아보기 1180·700 폭: 오류·흔적 없음", async () => {
    for (const vp of [{ width: 1180, height: 760 }, { width: 700, height: 500 }]) {
      const { page, context, errors } = await openApp(browser, { ...BIG, viewport: vp, files: { [TODAY]: "- [ ] 하나\n- [x] 둘\n", "someday.md": "- [ ] 언젠가\n" } });
      await page.clock.runFor(300);
      assert.deepEqual(errors, []);
      assert.ok(!/라이선스|체험|구매|업데이트/.test(await page.locator("body").innerText()));
      await context.close();
    }
  });

  await scenario("화면(QA4 F4) 메인 260×300: 창 아래에 저장됨·시각만, 업데이트 버튼이 없다", async () => {
    const { page, context, errors } = await openApp(browser, { viewport: { width: 260, height: 300 }, files: { [TODAY]: "- [ ] 하나\n" }, storage: { "aru.lastVersion": "0.1.0" } });
    await page.clock.runFor(1500);
    assert.match(await footText(page), /^저장됨/);
    assert.equal(await page.locator('[data-action="update"], .updated').count(), 0);
    assert.ok(!(await calls(page, "pending_update")).length, "등록되지 않은 명령을 부름");
    assert.deepEqual(errors, []);
    await context.close();
  });
}
