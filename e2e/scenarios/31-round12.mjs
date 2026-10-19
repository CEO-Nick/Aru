// 라운드 12 QA(QA12 R12-1~8: B1·B2)와 11차 코드 리뷰(M-N1). QA12 시나리오(qa12-ui/a-round12)를 옮기고 리뷰 항목을 더했다
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fs, openApp, scenario, texts } from "../harness.mjs";

const mock = readFileSync(new URL("../mockTauri.js", import.meta.url), "utf8");
const D13 = "daily/2026-10-13.md";
const D14 = "daily/2026-10-14.md";
const J = JSON.stringify;
const addInput = (page, list = "today") => page.locator(`[data-list="${list}"] .add input`);
const count = async (page, needle) => Object.values(await fs(page)).reduce((k, v) => k + v.split(needle).length - 1, 0);
const where = async (page, needle) =>
  Object.entries(await fs(page))
    .filter(([, v]) => v.includes(needle))
    .map(([k]) => k);
const stash = (page) =>
  page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("aru.draft.")).map((k) => [k, localStorage.getItem(k)])));

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
/** 지난 실행이 남긴 localStorage를 넣고 앱을 다시 켠다 */
async function seed(page, kv) {
  await page.evaluate((o) => Object.entries(o).forEach(([k, v]) => localStorage.setItem(k, v)), kv);
  await restart(page);
}
const badOnNextLoads = (context, paths) => context.addInitScript(`window.__badReads = ${J(paths)};`);

export default async function (browser) {
  const log = {};

  await scenario("R12-1 지난 실행의 거울 4자리(quick 오늘·언젠가, 모아보기 날·언젠가)가 모두 남은 채 켬 → 각 글이 한 번씩 들어가고, 다시 켜도 늘지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" },
    });
    await seed(page, {
        "aru.draft.quick.today": "큐오늘",
        "aru.draft.quick.someday": "큐언젠1\n큐언젠2",
        "aru.draft.overview.day": "모아날",
        "aru.draft.overview.someday": "모아언젠",
      });
    await page.clock.runFor(3000);
    await quit(page);
    log.r1_today = await texts(page, "today");
    log.r1_someday = await texts(page, "someday");
    log.r1_stash = await stash(page);
    for (const t of ["큐오늘", "큐언젠1", "큐언젠2", "모아날", "모아언젠"]) assert.equal(await count(page, t), 1, `${t} 개수 ` + J(await fs(page)));
    assert.deepEqual(await where(page, "큐오늘"), [D14]);
    await restart(page);
    await page.clock.runFor(4000);
    await quit(page);
    for (const t of ["큐오늘", "큐언젠1", "큐언젠2", "모아날", "모아언젠"]) assert.equal(await count(page, t), 1, `다시 켠 뒤 ${t} 개수 ` + J(await fs(page)));
    await context.close();
  });

  await scenario("R12-2 넘길 글이 언젠가에 이미 있는 안 끝낸 할 일과 같음 → 두 번 들어가면 안 된다(⌥Space 중복 건너뜀 정책)", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] 우유 사기\n" },
    });
    await seed(page, { "aru.draft.quick.someday": "우유 사기" });
    await page.clock.runFor(3000);
    await quit(page);
    log.r2_someday = (await fs(page))["someday.md"];
    assert.equal(await count(page, "우유 사기"), 1, "같은 할 일이 두 번: " + J(log.r2_someday));
    await context.close();
  });

  await scenario("R12-2b 같은 글이 ⌥Space 언젠가와 모아보기 언젠가 거울에 둘 다 남음 → 한 번만", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" },
    });
    await seed(page, { "aru.draft.quick.someday": "같은글", "aru.draft.overview.someday": "같은글" });
    await page.clock.runFor(3000);
    await quit(page);
    log.r2b_someday = (await fs(page))["someday.md"];
    assert.equal(await count(page, "같은글"), 1, "같은 글이 두 번: " + J(log.r2b_someday));
    await context.close();
  });

  await scenario("R12-3 언젠가가 막힌 채 2번 다시 켜고 그 사이 ⌥Space 창·모아보기를 띄워도 넘길 글은 남고, 읽히면 정확히 한 번", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" },
      globals: { __badReads: ["someday.md"] },
    });
    await page.evaluate(() => localStorage.setItem("aru.draft.orphan.quick.someday", "버티기"));
    await badOnNextLoads(context, ["someday.md"]);
    await restart(page);
    await page.clock.runFor(4000);
    await restart(page, "#quick");
    await page.locator(".quick input").press("Escape").catch(() => {});
    await restart(page, "#overview");
    await page.clock.runFor(2000);
    log.r3_mid = await stash(page);
    await restart(page);
    await page.clock.runFor(4000);
    log.r3_mid2 = await stash(page);
    assert.equal(log.r3_mid2["aru.draft.orphan.quick.someday"], "버티기", "막힌 동안 넘길 글이 사라짐 " + J(log));
    assert.equal(await count(page, "버티기"), 0);
    // 읽히게 된다(3초 확인으로)
    await page.evaluate(() => {
      window.__badReads = [];
      window.__emit("file-changed", { path: "someday.md", source: "cli" });
    });
    await page.clock.runFor(7000);
    await quit(page);
    log.r3_after = await stash(page);
    assert.equal(await count(page, "버티기"), 1, "개수 " + J(await fs(page)));
    assert.equal(log.r3_after["aru.draft.orphan.quick.someday"], undefined);
    await badOnNextLoads(context, []);
    await restart(page);
    await page.clock.runFor(4000);
    await quit(page);
    assert.equal(await count(page, "버티기"), 1, "다시 켠 뒤 개수 " + J(await fs(page)));
    await context.close();
  });

  await scenario("R12-4 (B2) 오늘이 막힌 채 오늘 입력칸 글 → ◀ 어제 → 어제를 보는 동안 오늘이 읽힘 → 어제에 안 들어가고, ▶ 오늘로 오면 한 번만 오늘에", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", [D13]: "- [x] 어제끝\n" } });
    await addInput(page).click();
    await page.keyboard.type("비투초안");
    await blockList(page, D14);
    await page.locator('[aria-label="이전 날"]').click();
    await page.clock.runFor(1000);
    log.r4_inputD13 = (await addInput(page).count()) ? await addInput(page).inputValue() : null;
    log.r4_stash1 = await stash(page);
    await page.evaluate(() => (window.__badReads = []));
    await page.clock.runFor(7000);
    assert.deepEqual(await where(page, "비투초안"), [], "어제를 보는 동안 어디엔가 들어감 " + J(await where(page, "비투초안")));
    assert.equal(log.r4_inputD13, "", "어제 입력칸에 따라감");
    await page.locator('[aria-label="다음 날"]').click();
    await page.clock.runFor(4000);
    await quit(page);
    log.r4_where = await where(page, "비투초안");
    log.r4_stash2 = await stash(page);
    assert.equal(await count(page, "비투초안"), 1, J({ where: log.r4_where, fs: await fs(page) }));
    assert.deepEqual(log.r4_where, [D14]);
    await restart(page);
    await page.clock.runFor(4000);
    await quit(page);
    assert.equal(await count(page, "비투초안"), 1, "다시 켠 뒤 " + J(await fs(page)));
    await context.close();
  });

  await scenario("R12-5 느린 켜기(읽기 6초) 도중 ⌥Space 창이 같은 저장소로 뜸 → 지난 거울 글은 지워지지 않고 작은 창이 한 번만 넣는다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n", "settings.json": '{"carryOver":"keep"}' } });
    await page.evaluate(() => localStorage.setItem("aru.draft.quick.someday", "느린켜기"));
    await context.addInitScript(`if (!location.hash) window.__readDelay = 6000;`);
    // 작은 창을 다시 켜는 중(읽기 느림)
    await page.evaluate(() => location.reload());
    await page.waitForSelector(".foot");
    // 같은 컨텍스트에 ⌥Space 창(localStorage 공유)
    const q = await context.newPage();
    await q.addInitScript(mock);
    await q.clock.install({ time: new Date("2026-10-14T10:00:01") });
    await q.goto("http://localhost:1430/#quick");
    await q.waitForSelector(".quick");
    await q.clock.runFor(500);
    log.r5_afterQuick = await stash(q);
    await q.close();
    await page.clock.runFor(12000);
    await quit(page);
    log.r5_where = await where(page, "느린켜기");
    log.r5_stash = await stash(page);
    assert.equal(await count(page, "느린켜기"), 1, J(log));
    await context.close();
  });

  await scenario("R12-6 ⌥Space 창이 떠 있고(저장 실패 글 보유) 그동안 작은 창이 3초 확인 → 작은 창은 거울을 건드리지 않는다(넘길 글로 옮기지 않음)", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" } });
    const q = await context.newPage();
    await q.addInitScript(mock);
    await q.clock.install({ time: new Date("2026-10-14T10:00:01") });
    await q.addInitScript(`window.__failWrites = true;`);
    await q.goto("http://localhost:1430/#quick");
    await q.waitForSelector(".quick");
    await q.locator(".quick input").fill("살아있는글");
    await q.locator(".quick input").press("Tab");
    await q.locator(".quick input").press("Enter");
    await q.clock.runFor(500);
    log.r6_q = await stash(q);
    await page.clock.runFor(7000);
    log.r6_main = await stash(page);
    assert.equal(await count(page, "살아있는글"), 0, "작은 창이 떠 있는 ⌥Space 창 글을 가져다 넣음 " + J(log));
    assert.equal(log.r6_main["aru.draft.quick.someday"], "살아있는글", J(log));
    await q.close();
    await context.close();
  });

  await scenario("R12-7 설정: 이 창에서 핀을 바꿔 쓴 뒤 다른 맥이 핀·투명도를 바꿈 → 3초 안에 다시 읽고 옛 핀 값으로 덮지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "settings.json": J({ carryOver: "keep", alwaysOnTop: true, opacity: 100, lastRolloverDate: "2026-10-14" }) },
    });
    await page.locator('[aria-label="항상 위에 고정"]').click();
    await page.clock.runFor(2000);
    const mid = JSON.parse((await fs(page))["settings.json"]);
    log.r7_mid = mid;
    assert.equal(mid.alwaysOnTop, false, "전제: 핀 끔 저장 " + J(mid));
    await page.evaluate((c) => window.__setFile("settings.json", c), J({ ...mid, alwaysOnTop: true, opacity: 60, carryOver: "someday" }));
    await page.clock.runFor(4000);
    // 아무 관계없는 설정 하나를 바꿔 쓰게 한다(핀은 그대로)
    await page.clock.runFor(2000);
    const after = JSON.parse((await fs(page))["settings.json"]);
    log.r7_after = after;
    assert.equal(after.alwaysOnTop, true, "다른 맥이 켠 핀을 옛 값으로 덮음 " + J(after));
    assert.equal(after.carryOver, "someday", J(after));
    await context.close();
  });

  await scenario("R12-7b 설정: 다른 맥이 carryOver를 바꾼 직후(3초 확인 전) 이 창에서 핀을 누름 → 파일에 둘 다 남는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "settings.json": J({ carryOver: "keep", alwaysOnTop: true, opacity: 100, allowExternalAdd: true, lastRolloverDate: "2026-10-14" }) },
    });
    await page.clock.runFor(3500);
    await page.evaluate(() => {
      const s = JSON.parse(window.__mockFs["settings.json"]);
      window.__setFile("settings.json", JSON.stringify({ ...s, carryOver: "next-day", allowExternalAdd: false }));
    });
    await page.locator('[aria-label="항상 위에 고정"]').click();
    await page.clock.runFor(8000);
    const after = JSON.parse((await fs(page))["settings.json"]);
    log.r7b_after = after;
    assert.equal(after.alwaysOnTop, false, J(after));
    assert.equal(after.allowExternalAdd, false, "다른 맥이 끈 AI 추가가 다시 켜짐 " + J(after));
    assert.equal(after.carryOver, "next-day", J(after));
    await context.close();
  });

  await scenario("R12-8 (L4/재시작 반복) 오늘 막힘 + 오늘 입력칸 글 → 종료·막힌 채 다시 켜기 2회 → 읽히면 입력칸에 한 번만 돌아오고 할 일로 두 번 들어가지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" } });
    await addInput(page).click();
    await page.keyboard.type("반복초안");
    await blockList(page, D14);
    await quit(page);
    await badOnNextLoads(context, [D14]);
    await restart(page);
    await page.clock.runFor(4000);
    await quit(page);
    await restart(page);
    await page.clock.runFor(4000);
    await quit(page);
    log.r8_stash = await stash(page);
    await badOnNextLoads(context, []);
    await restart(page);
    await page.clock.runFor(4000);
    log.r8_input = (await addInput(page).count()) ? await addInput(page).inputValue() : null;
    await quit(page);
    log.r8_count = await count(page, "반복초안");
    log.r8_stash2 = await stash(page);
    assert.ok(log.r8_count === 1 || (log.r8_count === 0 && log.r8_input === "반복초안"), J(log));
    assert.ok(log.r8_count <= 1, J(log));
    await context.close();
  });

  await scenario("M-N1 읽은 적 있는 settings.json이 잠깐 없어져도(iCloud 내려 둠) 3초 확인이 기본값으로 내려가지 않고, 그 뒤 핀을 눌러도 진짜 설정을 덮지 않는다", async () => {
    const real = { opacity: 40, carryOver: "next-day", allowExternalAdd: false, alwaysOnTop: true, lastRolloverDate: "2026-10-14" };
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "settings.json": J(real) } });
    await page.clock.runFor(1000);
    await page.evaluate(() => window.__setFile("settings.json", null));
    await page.clock.runFor(4000);
    await page.locator('[aria-label="항상 위에 고정"]').click();
    await page.clock.runFor(4000);
    const after = JSON.parse((await fs(page))["settings.json"]);
    assert.deepEqual({ ...after, splitRatio: undefined, sortChecked: undefined }, { ...real, alwaysOnTop: false, splitRatio: undefined, sortChecked: undefined }, J(after));
    await context.close();
  });
}
