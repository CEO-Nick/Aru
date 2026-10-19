// 라운드 11 QA(QA11 Q11-1~4: B1·B2·B3)와 10차 코드 리뷰(H1·M1·L1·L2·L4). QA11 시나리오(qa11-ui/a-round11)를 옮기고 리뷰 항목을 더했다.
// 넘길 글(aru.draft.orphan.*)은 작은 창만 넣고, 창마다 제 거울(aru.draft.<창>.*)만 쓴다
import assert from "node:assert/strict";
import { fs, openApp, scenario, texts } from "../harness.mjs";

const D13 = "daily/2026-10-13.md";
const D14 = "daily/2026-10-14.md";
const J = JSON.stringify;
const addInput = (page, list = "today") => page.locator(`[data-list="${list}"] .add input`);
const footText = async (page) => (await page.locator(".foot").textContent()).replace(/\s+/g, " ").trim();
const where = async (page, needle) =>
  Object.entries(await fs(page))
    .filter(([, v]) => v.includes(needle))
    .map(([k]) => k);
const count = async (page, needle) => Object.values(await fs(page)).reduce((n, v) => n + v.split(needle).length - 1, 0);
const stash = (page) =>
  page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("aru.draft.")).map((k) => [k, localStorage.getItem(k)])));
const stashed = async (page, needle) => Object.values(await stash(page)).some((v) => v.split("\n").includes(needle));

async function quit(page) {
  await page.evaluate(() => window.__emit("quit-requested", null));
  await page.clock.runFor(3000);
}
async function blockList(page, path) {
  await page.evaluate((p) => {
    window.__badReads = [...(window.__badReads || []), p];
    window.__emit("file-changed", { path: p, source: "cli" });
  }, path);
  await page.clock.runFor(500);
}
async function restart(page, hash = "") {
  const loaded = page.waitForEvent("load");
  await page.evaluate((h) => {
    history.replaceState(null, "", `/${h}`);
    location.reload();
  }, hash);
  await loaded;
  await page.waitForSelector(hash.startsWith("#quick") ? ".quick" : ".foot");
  await page.clock.runFor(1000);
}
/** 다음 실행부터 이 파일들을 못 읽게(또는 [] 로 풀게) 한다 */
const badOnNextLoads = (context, paths) => context.addInitScript(`window.__badReads = ${J(paths)};`);

async function quickFail(page, text, toSomeday) {
  await page.evaluate(() => (window.__failWrites = true));
  await page.locator(".quick input").fill(text);
  if (toSomeday) await page.keyboard.press("Tab");
  await page.locator(".quick input").press("Enter");
  await page.clock.runFor(500);
  assert.equal(await page.locator(".quick input").inputValue(), text, "전제: 저장 실패로 칸에 남음");
}
/** 지난 세션이 이 맥에 남긴 글. openApp의 storage는 새로 켤 때마다 다시 넣으므로 한 번만 넣는다 */
const seed = (page, entries) =>
  page.evaluate((e) => {
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
  }, entries);
/** 빠른 입력창에서 글자를 쳤다가 지우고 닫는다(창이 제 상태를 거울에 다시 쓰게) */
async function touchQuick(page) {
  await page.locator(".quick input").fill("z");
  await page.locator(".quick input").fill("");
  await page.locator(".quick input").press("Escape");
  await page.clock.runFor(100);
}

export default async function (browser) {
  // ── B1·H1: 작은 창이 넣지 못한 글은 넘길 글로 남고, 빠른 입력창이 뜨거나 글자를 쳐도 지워지지 않는다 ──
  await scenario("Q11-1 ⌥Space 실패 글 → 다시 켤 때 언젠가가 막혀 못 넣음 → ⌥Space 창을 띄우고 글자를 쳐도 남고, 읽히면 언젠가에 한 번 들어간다", async () => {
    const { page, context, errors } = await openApp(browser, { hash: "#quick", files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" } });
    await quickFail(page, "빠른남음", true);
    await badOnNextLoads(context, ["someday.md"]);
    await restart(page);
    await page.clock.runFor(2000);
    assert.ok(await stashed(page, "빠른남음"), "전제: 막혀서 못 넣고 남김 " + J(await stash(page)));
    await restart(page, "#quick");
    await touchQuick(page);
    assert.ok(await stashed(page, "빠른남음"), "⌥Space 창을 띄우자 남겨 둔 글이 지워짐: " + J(await stash(page)));
    await badOnNextLoads(context, []);
    await restart(page);
    await page.clock.runFor(2000);
    assert.equal(await count(page, "빠른남음"), 1, J(await fs(page)));
    assert.ok((await texts(page, "someday")).includes("빠른남음"));
    assert.deepEqual(await stash(page), {});
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("Q11-1b (오늘 쪽) ⌥Space 오늘 실패 글 → 다시 켤 때 오늘이 막힘 → ⌥Space 창 띄움 → 다음 실행에 오늘에 한 번 들어간다", async () => {
    const { page, context } = await openApp(browser, { hash: "#quick", files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" } });
    await quickFail(page, "빠른오늘", false);
    await badOnNextLoads(context, [D14]);
    await restart(page);
    await page.clock.runFor(2000);
    await restart(page, "#quick");
    await touchQuick(page);
    await badOnNextLoads(context, []);
    await restart(page);
    await page.clock.runFor(2000);
    assert.deepEqual(await where(page, "빠른오늘"), [D14], J(await fs(page)));
    assert.equal(await count(page, "빠른오늘"), 1);
    assert.ok((await texts(page, "today")).includes("빠른오늘"));
    await context.close();
  });

  await scenario("H1-B 켜자마자 ⌥Space(작은 창이 남은 글을 넣기 전, 빠른 입력창이 먼저 뜸): 지난 세션의 빠른 입력 글이 지워지지 않고 작은 창에 들어간다", async () => {
    const { page, context } = await openApp(browser, {
      hash: "#quick",
      files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" },
    });
    await seed(page, { "aru.draft.quick.someday": "우유", "aru.draft.quick.today": "빵" });
    await restart(page, "#quick");
    await touchQuick(page);
    assert.ok((await stashed(page, "우유")) && (await stashed(page, "빵")), J(await stash(page)));
    await restart(page);
    await page.clock.runFor(2000);
    assert.deepEqual(await where(page, "우유"), ["someday.md"], J(await fs(page)));
    assert.deepEqual(await where(page, "빵"), [D14]);
    assert.equal((await count(page, "우유")) + (await count(page, "빵")), 2);
    assert.deepEqual(await stash(page), {});
    await context.close();
  });

  await scenario("H1-B2 느린 폴더(읽기 3초)로 켜는 동안 남은 글은 이미 넘길 글로 옮겨져 있다(작은 창이 다 읽기 전)", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" },
    });
    await seed(page, { "aru.draft.quick.someday": "느린우유" });
    await context.addInitScript("window.__readDelay = 3000;");
    await restart(page);
    // 아직 목록을 다 읽지 못했어도 빠른 입력창 거울에는 남아 있지 않다(곧 뜰 빠른 입력창이 지울 수 없다)
    const early = await stash(page);
    assert.equal(early["aru.draft.quick.someday"], undefined, J(early));
    assert.ok(await stashed(page, "느린우유"));
    await page.evaluate(() => (window.__readDelay = 0));
    await page.clock.runFor(8000);
    assert.deepEqual(await where(page, "느린우유"), ["someday.md"], J(await fs(page)));
    assert.deepEqual(await stash(page), {});
    await context.close();
  });

  // ── H1(모아보기 거울)·L2: 넘길 글은 작은 창만 넣는다. 모아보기는 그 글을 입력칸에 되돌리거나 덮지 않는다 ──
  await scenario("H1-O 모아보기에 남은 글 → 다시 켤 때 언젠가 막힘 → 모아보기를 열어 칸을 고쳐도 그 글은 남고, 읽히면 한 번만 들어간다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" },
      viewport: { width: 1180, height: 760 },
    });
    await seed(page, { "aru.draft.overview.someday": "모아언젠" });
    await badOnNextLoads(context, ["someday.md"]);
    await restart(page);
    await page.clock.runFor(2000);
    assert.ok(await stashed(page, "모아언젠"), "전제: 막혀서 남김");
    await badOnNextLoads(context, []);
    await restart(page, "#overview");
    assert.equal(await addInput(page, "someday").inputValue(), "", "넘길 글을 모아보기가 입력칸에 되돌림");
    await addInput(page, "someday").fill("모아새글");
    await addInput(page, "someday").fill("");
    await page.clock.runFor(500);
    assert.ok(await stashed(page, "모아언젠"), "모아보기가 넘길 글을 덮음: " + J(await stash(page)));
    await quit(page);
    await restart(page);
    await page.clock.runFor(4000);
    assert.equal(await count(page, "모아언젠"), 1, J(await fs(page)));
    assert.deepEqual(await stash(page), {});
    await context.close();
  });

  await scenario("Q11-4 모아보기 남은 글 → 다시 켤 때 언젠가 막힘(남김) → 모아보기를 열면 입력칸에 되돌리지 않고, 닫고 다시 켜면 한 번만 들어간다(L2)", async () => {
    const { page, context } = await openApp(browser, {
      hash: "#overview",
      viewport: { width: 1180, height: 760 },
      files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" },
    });
    await addInput(page, "overview").click();
    await page.keyboard.type("모아한번");
    await blockList(page, D14);
    await quit(page);
    await badOnNextLoads(context, ["someday.md", D14]);
    await restart(page);
    await page.clock.runFor(2000);
    await badOnNextLoads(context, []);
    await restart(page, "#overview");
    await page.clock.runFor(1000);
    assert.equal(await addInput(page, "overview").inputValue(), "", "넘길 글을 모아보기도 되돌리면 두 번 들어간다");
    await quit(page);
    await restart(page);
    await page.clock.runFor(4000);
    assert.equal(await count(page, "모아한번"), 1, J({ where: await where(page, "모아한번") }));
    await context.close();
  });

  // ── L1: 넘길 글이 여럿이면 한 줄 입력칸에 합치지 않고 하나씩 할 일로 넣는다 ──
  await scenario("L1 빠른 입력 글 둘이 넘길 글로 남은 채 모아보기를 열어도 합쳐 되돌리지 않고, 작은 창이 각각 할 일로 넣는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" },
      viewport: { width: 1180, height: 760 },
    });
    await seed(page, { "aru.draft.quick.someday": "가\n나" });
    await badOnNextLoads(context, ["someday.md"]);
    await restart(page);
    await page.clock.runFor(2000);
    await badOnNextLoads(context, []);
    await restart(page, "#overview");
    const inputs = await page.locator(".add input").evaluateAll((els) => els.map((e) => e.value));
    assert.ok(inputs.every((v) => v === ""), J(inputs));
    await restart(page);
    await page.clock.runFor(4000);
    const someday = await texts(page, "someday");
    assert.ok(someday.includes("가") && someday.includes("나") && !someday.some((t) => t.includes("가 나")), J({ someday, fs: await fs(page) }));
    await context.close();
  });

  // ── B2: 막힌 목록에 되돌린 오늘 글은 ◀로 다른 날을 봐도 따라가지 않는다 ──
  await scenario("Q11-2 막힌 오늘 입력칸 글(다시 켠 뒤 들고만 있음) → ◀ 어제로 → 종료해도 어제 파일에 들어가지 않고, 오늘이 읽히면 오늘에 들어간다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", [D13]: "- [x] 어제끝\n" } });
    await addInput(page).click();
    await page.keyboard.type("오늘초안");
    await blockList(page, D14);
    await quit(page);
    await badOnNextLoads(context, [D14]);
    await restart(page);
    await page.clock.runFor(1000);
    assert.equal(await addInput(page).count(), 0, "전제: 오늘 잠김");
    await page.locator('[aria-label="이전 날"]').click();
    await page.clock.runFor(1000);
    assert.equal(await addInput(page).inputValue(), "", "어제 입력칸으로 따라옴");
    await quit(page);
    assert.deepEqual((await where(page, "오늘초안")).filter((p) => p === D13), [], J(await fs(page)));
    assert.ok(await stashed(page, "오늘초안"), "잃음: " + J(await stash(page)));
    await badOnNextLoads(context, []);
    await restart(page);
    await page.clock.runFor(4000);
    assert.deepEqual(await where(page, "오늘초안"), [D14], J(await fs(page)));
    assert.equal(await count(page, "오늘초안"), 1);
    await context.close();
  });

  // ── B3·M1: 주 창도 settings.json을 다시 읽어, 하나를 바꿀 때 받은 설정을 덮지 않는다 ──
  await scenario("Q11-3 켤 때 settings.json이 아직 없음(iCloud 내려받는 중) → 잠시 뒤 도착 → 핀을 누르면 도착한 설정(carryOver·AI 추가)을 덮지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n" } });
    await page.clock.runFor(2000);
    const real = { carryOver: "next-day", allowExternalAdd: false, opacity: 40, lastRolloverDate: "2026-10-14" };
    await page.evaluate((c) => window.__setFile("settings.json", c), J(real));
    await page.clock.runFor(15_000);
    await page.locator('[aria-label="항상 위에 고정"]').click();
    await page.clock.runFor(2000);
    const after = JSON.parse((await fs(page))["settings.json"]);
    assert.equal(after.carryOver, "next-day", J(after));
    assert.equal(after.allowExternalAdd, false, J(after));
    assert.equal(after.opacity, 40, J(after));
    assert.equal(after.alwaysOnTop, false, J(after));
    await context.close();
  });

  await scenario("M1 설정 파일이 늦게 도착한 직후(3초 확인 전) 투명도를 바꿔도, 쓰기 직전에 다시 읽어 진짜 값을 지킨다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n" } });
    await page.clock.runFor(3500);
    await page.evaluate((c) => window.__setFile("settings.json", c), J({ carryOver: "someday", allowExternalAdd: false, splitRatio: 0.3 }));
    await page.locator('[aria-label="항상 위에 고정"]').click();
    await page.clock.runFor(1500);
    const after = JSON.parse((await fs(page))["settings.json"]);
    assert.deepEqual([after.carryOver, after.allowExternalAdd, after.splitRatio, after.alwaysOnTop], ["someday", false, 0.3, false], J(after));
    await context.close();
  });

  await scenario("M1b 모아보기(또는 다른 맥)가 설정을 바꾼 뒤 작은 창에서 하나를 바꾸면, 받은 값을 옛 값으로 덮지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "settings.json": J({ carryOver: "keep", allowExternalAdd: true, sortChecked: true }) },
    });
    await page.clock.runFor(1000);
    await page.evaluate((c) => {
      window.__setFile("settings.json", c);
      window.__emit("file-changed", { path: "settings.json", source: "overview" });
    }, J({ carryOver: "next-day", allowExternalAdd: false, sortChecked: false }));
    await page.clock.runFor(300);
    await page.locator('[aria-label="항상 위에 고정"]').click();
    await page.clock.runFor(1500);
    const after = JSON.parse((await fs(page))["settings.json"]);
    assert.deepEqual([after.carryOver, after.allowExternalAdd, after.sortChecked, after.alwaysOnTop], ["next-day", false, false, false], J(after));
    // 다른 맥이 파일만 바꿔 놓은 경우(알림 없음)도 3초 확인이 받아 온다
    await page.evaluate((c) => window.__setFile("settings.json", c), J({ ...JSON.parse((await fs(page))["settings.json"]), sortChecked: true }));
    await page.clock.runFor(3500);
    await page.locator('[aria-label="항상 위에 고정"]').click();
    await page.clock.runFor(1500);
    const later = JSON.parse((await fs(page))["settings.json"]);
    assert.deepEqual([later.sortChecked, later.alwaysOnTop, later.carryOver], [true, true, "next-day"], J(later));
    await context.close();
  });

  await scenario("M1c 설정이 그대로면 3초 확인이 설정 파일을 다시 쓰지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "settings.json": J({ carryOver: "keep", opacity: 80 }) },
    });
    await page.clock.runFor(2000);
    const settingsWrites = () => page.evaluate(() => window.__writes.filter(([p]) => p === "settings.json").length);
    const before = await settingsWrites();
    await page.clock.runFor(10_000);
    assert.equal(await settingsWrites(), before);
    assert.match(await footText(page), /./);
    await context.close();
  });
}
