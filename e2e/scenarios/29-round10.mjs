// 라운드 10 QA(QA10 R10-1~14)와 9차 코드 리뷰(N1·N2·N4·N5). QA10 시나리오(qa10-ui/a-round10)를 옮기고,
// 입력칸 글을 이 맥(localStorage)에 따로 남겼다가 다시 열 때 되돌리는 안전망과 리뷰 항목을 더했다
import assert from "node:assert/strict";
import { calls, caretToEnd, fs, openApp, reload, scenario, texts } from "../harness.mjs";

const D11 = "daily/2026-10-11.md";
const D12 = "daily/2026-10-12.md";
const D13 = "daily/2026-10-13.md";
const D14 = "daily/2026-10-14.md";
const J = JSON.stringify;
const addInput = (page, list = "today") => page.locator(`[data-list="${list}"] .add input`);
const itemText = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .text`).nth(i);
const footText = async (page) => (await page.locator(".foot").textContent()).replace(/\s+/g, " ").trim();
const where = async (page, needle) =>
  Object.entries(await fs(page))
    .filter(([, v]) => v.includes(needle))
    .map(([k]) => k);
const count = async (page, needle) => Object.values(await fs(page)).reduce((n, v) => n + v.split(needle).length - 1, 0);
const stash = (page) =>
  page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("aru.draft.")).map((k) => [k, localStorage.getItem(k)])));
const reads = async (page, path) => (await calls(page, "read_text")).filter((a) => a.path === path).length;

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
async function rootChanged(page, changed) {
  await page.evaluate((c) => window.__emit("data-root-changed", c), changed);
  await page.clock.runFor(3000).catch(() => {});
  await page.waitForSelector(".foot");
  await page.clock.runFor(2000);
}
/** 앱을 끄고 다시 켠다. hash를 주면 그 창으로 연다(빠른 입력·모아보기는 앱을 켤 때 없다) */
async function restart(page, hash = "") {
  await page.evaluate((h) => {
    history.replaceState(null, "", `/${h}`);
    location.reload();
  }, hash);
  await page.waitForSelector(hash.startsWith("#quick") ? ".quick" : ".foot");
  await page.clock.runFor(1000);
}

export default async function (browser) {
  // ── 입력칸 글 안전망: 목록이 막혀 넣지 못한 글은 이 맥에 남겼다가 다시 열 때 그 입력칸에 되돌린다 ──
  await scenario("R10-1 언젠가 목록이 막힌 채 언젠가 입력칸 글 → 종료 → 다시 켜면 언젠가 입력칸에 돌아온다(한 번만 들어간다)", async () => {
    const { page, context, errors } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" } });
    await addInput(page, "someday").click();
    await page.keyboard.type("언젠쓰다");
    await blockList(page, "someday.md");
    assert.equal(await addInput(page, "someday").count(), 0, "전제: 언젠가 잠김");
    await quit(page);
    assert.equal((await calls(page, "quit_ready")).length, 1);
    assert.deepEqual(await where(page, "언젠쓰다"), [], "막힌 목록이라 파일에는 아직 없다");
    await restart(page);
    assert.equal(await addInput(page, "someday").inputValue(), "언젠쓰다", J(await stash(page)));
    await addInput(page, "someday").press("Enter");
    await page.clock.runFor(2000);
    assert.equal(await count(page, "언젠쓰다"), 1, J(await fs(page)));
    assert.deepEqual(await stash(page), {}, "넣은 뒤에는 남기지 않는다");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("R10-2(L4) 언젠가 목록이 막힌 채 언젠가 입력칸 글 → 폴더 변경(copied)으로 새로고침: 새 폴더에 말없이 넣지 않고 입력칸에 되돌려 알린다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" } });
    await addInput(page, "someday").click();
    await page.keyboard.type("언젠쓰다");
    await blockList(page, "someday.md");
    let reloaded = false;
    page.on("load", () => (reloaded = true));
    await rootChanged(page, { copied: true, reason: "copied" });
    assert.ok(reloaded, "전제: 새로고침됨");
    assert.equal(await count(page, "언젠쓰다"), 0, J(await fs(page)));
    assert.equal(await addInput(page, "someday").inputValue(), "언젠쓰다");
    assert.match(await footText(page), /넣지 못한 글/);
    await addInput(page, "someday").press("Enter");
    await page.clock.runFor(2000);
    assert.equal(await count(page, "언젠쓰다"), 1, J(await fs(page)));
    assert.match((await fs(page))["someday.md"], /- \[ \] 언젠쓰다/);
    assert.deepEqual(await stash(page), {});
    await context.close();
  });

  await scenario("R10-3 오늘·언젠가 둘 다 막힘 + 두 입력칸에 글 → 종료 → 여전히 막힌 채 다시 켜도 잃지 않고, 읽히면 각 입력칸에 돌아온다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" },
      globals: { __badReads: [] },
    });
    await addInput(page).click();
    await page.keyboard.type("오늘쓰다");
    await addInput(page, "someday").click();
    await page.keyboard.type("언젠쓰다");
    await blockList(page, D14);
    await blockList(page, "someday.md");
    await quit(page);
    // 다시 켜도 두 파일 다 못 읽는다
    await page.addInitScript(([a, b]) => (window.__badReads = [a, b]), [D14, "someday.md"]);
    await restart(page);
    assert.match(await footText(page), /읽지 못한 파일/);
    await page.clock.runFor(10_000);
    assert.equal(Object.keys(await stash(page)).length, 2, J(await stash(page)));
    await page.evaluate(() => {
      window.__badReads = [];
      window.__emit("file-changed", { path: "daily/2026-10-14.md", source: "cli" });
      window.__emit("file-changed", { path: "someday.md", source: "cli" });
    });
    await page.clock.runFor(1000);
    assert.equal(await addInput(page).inputValue(), "오늘쓰다");
    assert.equal(await addInput(page, "someday").inputValue(), "언젠쓰다");
    await context.close();
  });

  await scenario("R10-4 모아보기: 고른 날이 막힌 채 입력칸 글 → 종료 → 모아보기를 다시 열면 그 입력칸에 돌아온다", async () => {
    const { page, context } = await openApp(browser, {
      hash: "#overview",
      viewport: { width: 1180, height: 760 },
      files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" },
    });
    await addInput(page, "overview").click();
    await page.keyboard.type("모아쓰다");
    await blockList(page, D14);
    await quit(page);
    await restart(page, "#overview");
    assert.equal(await addInput(page, "overview").inputValue(), "모아쓰다");
    await context.close();
  });

  await scenario("안전망: 입력칸에 쓰다 만 글은 창이 그냥 새로고침돼도(종료 처리 없이) 그 입력칸에 돌아온다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n" } });
    await addInput(page).click();
    await page.keyboard.type("오늘쓰다");
    await addInput(page, "someday").click();
    await page.keyboard.type("언젠쓰다");
    await reload(page);
    assert.equal(await addInput(page).inputValue(), "오늘쓰다");
    assert.equal(await addInput(page, "someday").inputValue(), "언젠쓰다");
    await context.close();
  });

  await scenario("안전망: 종료 때 할 일로 넣은 글은 다시 켤 때 입력칸에 또 나타나지 않는다(중복 없음)", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n" } });
    await addInput(page).click();
    await page.keyboard.type("오늘글");
    await addInput(page, "someday").click();
    await page.keyboard.type("언젠글");
    await quit(page);
    await restart(page);
    assert.equal(await addInput(page).inputValue(), "");
    assert.equal(await addInput(page, "someday").inputValue(), "");
    assert.equal(await count(page, "오늘글"), 1);
    assert.equal(await count(page, "언젠글"), 1);
    await context.close();
  });

  await scenario("안전망: ⌥Space 창에서 저장하지 못한 글은 종료 후 다시 켜면 작은 창의 그 목록에 들어간다", async () => {
    const { page, context, errors } = await openApp(browser, { hash: "#quick", files: { [D14]: "- [ ] a\n" } });
    await page.evaluate(() => (window.__failWrites = true));
    await page.locator(".quick input").fill("빠른언젠");
    await page.keyboard.press("Tab");
    await page.locator(".quick input").press("Enter");
    await page.clock.runFor(500);
    assert.equal(await page.locator(".quick input").inputValue(), "빠른언젠", "전제: 저장 실패로 칸에 남음");
    // 종료(빠른 입력창은 기다리지 않는다) → 다시 켜면 작은 창만 뜬다
    await restart(page);
    await page.clock.runFor(2000);
    const f = await fs(page);
    assert.match(f["someday.md"] ?? "", /빠른언젠/, J(f));
    assert.ok((await texts(page, "someday")).includes("빠른언젠"));
    assert.deepEqual(await stash(page), {});
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("안전망: 모아보기에 남은 글은 앱을 다시 켤 때(모아보기는 아직 없음) 작은 창의 언젠가에 들어간다", async () => {
    const { page, context } = await openApp(browser, {
      hash: "#overview",
      viewport: { width: 1180, height: 760 },
      files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" },
    });
    await addInput(page, "overview").click();
    await page.keyboard.type("모아남은");
    await blockList(page, D14);
    await quit(page);
    await restart(page);
    await page.clock.runFor(2000);
    assert.ok((await texts(page, "someday")).includes("모아남은"), J(await texts(page, "someday")));
    assert.match((await fs(page))["someday.md"], /모아남은/);
    assert.deepEqual(await stash(page), {});
    await context.close();
  });

  await scenario("R10-5 폴더 변경(copied) 직후 새 폴더 쓰기 실패 → 새로고침 안 됨, 입력칸 글은 할 일 1개 → 쓰기 회복 후 파일에 정확히 1번", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] 원래\n" } });
    await addInput(page).click();
    await page.keyboard.type("한번만");
    await page.evaluate((p) => (window.__failPaths = [p]), D14);
    let reloaded = false;
    page.on("load", () => (reloaded = true));
    await page.evaluate(() => window.__emit("data-root-changed", { copied: true, reason: "copied" }));
    await page.clock.runFor(4000);
    assert.equal(reloaded, false);
    assert.equal((await texts(page, "today")).filter((t) => t === "한번만").length, 1);
    await page.evaluate(() => (window.__failPaths = []));
    await page.clock.runFor(15000);
    assert.equal((await fs(page))[D14].split("한번만").length - 1, 1, J(await fs(page)));
    await rootChanged(page, { copied: true, reason: "copied" });
    assert.equal((await fs(page))[D14].split("한번만").length - 1, 1);
    assert.equal((await texts(page, "today")).filter((t) => t === "한번만").length, 1);
    await context.close();
  });

  await scenario("R10-6 종료 요청이 두 번 오고 그 사이 폴더 변경도 옴: 입력칸 글은 정확히 1번 저장", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "someday.md": "" } });
    await addInput(page).click();
    await page.keyboard.type("중복검사");
    await page.evaluate(() => {
      window.__writeDelay = 300;
      window.__emit("quit-requested", null);
      window.__emit("quit-requested", null);
      window.__emit("data-root-changed", { copied: true, reason: "copied" });
    });
    await page.clock.runFor(4000).catch(() => {});
    await page.waitForSelector(".foot");
    await page.clock.runFor(2000);
    assert.equal(await count(page, "중복검사"), 1, J(await fs(page)));
    assert.equal(await addInput(page).inputValue(), "");
    await context.close();
  });

  await scenario("R10-7 kept 폴더(같은 날 파일에 같은 할 일)로 바꾸며 입력칸 글: 유실·중복 없음", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] 공통\n- [ ] 옛것\n" } });
    await addInput(page).click();
    await page.keyboard.type("새글");
    await page.evaluate((d) => {
      for (const k of Object.keys(window.__mockFs)) window.__setFile(k, null);
      window.__setFile(d, "- [ ] 공통\n- [ ] 거기\n");
      window.__setRootEmits = true;
    }, D14);
    await rootChanged(page, { copied: false, reason: "kept" });
    const f = (await fs(page))[D14];
    assert.equal(f.split("공통").length - 1, 1, "같은 할 일 중복");
    assert.ok(f.includes("새글") && f.includes("거기") && f.includes("옛것"), J(f));
    await context.close();
  });

  await scenario("R10-8 입력칸 경계값: 5000자 글은 남고 공백만은 넣지도 남기지도 않는다(폴더 변경)", async () => {
    const long = "가".repeat(5000);
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n" } });
    await addInput(page).fill(long);
    await addInput(page, "someday").fill("   ");
    await rootChanged(page, { copied: true, reason: "copied" });
    const f = await fs(page);
    assert.ok((f[D14] || "").includes(long));
    assert.ok(!(f["someday.md"] ?? "").includes("- [ ]   "), "공백만은 넣지 않는다");
    assert.deepEqual(await stash(page), {});
    await context.close();
  });

  // ── 자정 정리: 정리한 날은 다시 정리하지 않는다(R10-9), 못 읽는 날 때문에 3초마다 범위를 다시 읽지 않는다(N2) ──
  await scenario("R10-9 지난 날 하나가 계속 안 읽힘(next-day) → ◀ 이미 정리한 날에 적은 할 일은 3초가 지나도 그 날에 남는다", async () => {
    const { page, context } = await openApp(browser, {
      files: {
        "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-11" }),
        [D11]: "BAD",
        [D12]: "- [x] 끝\n",
        [D13]: "- [ ] 13원래\n",
        [D14]: "- [ ] 오늘원래\n",
      },
      globals: { __badReads: [D11] },
    });
    await page.clock.runFor(500);
    assert.match((await fs(page))[D14], /13원래/, "전제: 못 읽은 날 뒤의 날은 정리됨");
    await page.locator('[aria-label="이전 날"]').click();
    await page.clock.runFor(300);
    await page.locator('[aria-label="이전 날"]').click();
    await page.clock.runFor(300);
    await addInput(page).click();
    await page.keyboard.type("기록용");
    await page.keyboard.press("Enter");
    await page.clock.runFor(7000);
    assert.ok((await texts(page, "today")).includes("기록용"), "보던 날에서 적은 할 일이 사라짐");
    assert.deepEqual(await where(page, "기록용"), [D12]);
    // 다시 켜도 그 날을 다시 정리하지 않는다
    await reload(page);
    await page.clock.runFor(4000);
    assert.deepEqual(await where(page, "기록용"), [D12], J(await fs(page)));
    await context.close();
  });

  await scenario("R10-9b 못 읽던 날이 읽히게 되면 그 날만 정리하고, 그 사이 적은 다른 지난 날 할 일은 그대로 둔다", async () => {
    const { page, context } = await openApp(browser, {
      files: {
        "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-11" }),
        [D11]: "- [ ] 11원래\n",
        [D12]: "- [ ] 12원래\n",
        [D14]: "- [ ] 오늘원래\n",
      },
      globals: { __badReads: [D11] },
    });
    await page.clock.runFor(500);
    await page.evaluate((d) => window.__setFile(d, (window.__mockFs[d] ?? "") + "- [ ] 나중에적음\n"), D12);
    await page.evaluate(() => (window.__badReads = []));
    await page.clock.runFor(4000);
    const f = await fs(page);
    assert.match(f[D14], /11원래/, J(f));
    assert.match(f[D14], /12원래/, J(f));
    assert.match(f[D12] ?? "", /나중에적음/, J(f));
    assert.equal(JSON.parse(f["settings.json"]).lastRolloverDate, "2026-10-14");
    await context.close();
  });

  await scenario("R10-10·N2 지난 날이 계속 안 읽히는 동안 오늘 할 일을 천천히 고쳐도 글자가 유지되고, 3초마다 지난 범위를 다시 읽지 않는다", async () => {
    const { page, context, errors } = await openApp(browser, {
      files: {
        "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-12" }),
        [D12]: "BAD",
        [D13]: "- [ ] 13원래\n",
        [D14]: "- [ ] 오늘\n",
        "someday.md": "- [ ] s\n",
      },
      globals: { __badReads: [D12] },
    });
    await page.clock.runFor(500);
    await itemText(page, 0).click();
    await caretToEnd(page);
    for (const ch of "가나다라") {
      await page.keyboard.type(ch);
      await page.clock.runFor(1100);
    }
    await page.clock.runFor(3000);
    const t = await texts(page, "today");
    assert.ok(t.some((x) => x.includes("오늘가나다라")), J(t));
    assert.equal((await fs(page))[D14].split("13원래").length - 1, 1);
    const r13 = await reads(page, D13);
    const w0 = (await calls(page, "write_text")).length;
    await page.clock.runFor(30_000);
    assert.equal((await reads(page, D13)) - r13, 0, "못 읽는 날 하나 때문에 지난 범위를 다시 읽음");
    assert.ok((await calls(page, "write_text")).length - w0 <= 1);
    assert.deepEqual(errors, []);
    await context.close();
  });

  // ── 설정·창 적용 ──
  await scenario("R10-11 설정 파일 경계값(opacity -50/500, alwaysOnTop false) → 창 투명도 0.2/1.0, 핀 false", async () => {
    for (const [op, alpha] of [
      [-50, 0.2],
      [500, 1],
    ]) {
      const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "settings.json": J({ opacity: op, alwaysOnTop: false }) } });
      const a = (await calls(page, "set_window_opacity")).at(-1)?.alpha;
      assert.ok(Math.abs(a - alpha) < 1e-6, `opacity ${op} → ${a}`);
      assert.equal((await calls(page, "plugin:window|set_always_on_top")).at(-1)?.value, false);
      await context.close();
    }
  });

  await scenario("R10-12 설정 없는 kept 폴더로 바꾸면 그 폴더의 지난 날 남은 일도 이 창 설정(다음 날로)대로 한 번 정리된다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "settings.json": J({ carryOver: "next-day", lastRolloverDate: "2026-10-14" }) },
    });
    await page.evaluate((d) => {
      for (const k of Object.keys(window.__mockFs)) window.__setFile(k, null);
      window.__setFile(d, "- [ ] 밀린일\n");
      window.__setRootEmits = true;
    }, D12);
    await rootChanged(page, { copied: false, reason: "kept" });
    await page.clock.runFor(2000);
    const f = await fs(page);
    assert.equal(JSON.parse(f["settings.json"]).carryOver, "next-day");
    assert.match(f[D14] ?? "", /밀린일/, J(f));
    assert.doesNotMatch(f[D12] ?? "", /밀린일/, J(f));
    assert.equal(JSON.parse(f["settings.json"]).lastRolloverDate, "2026-10-14");
    await context.close();
  });

  await scenario("N1 켤 때 폴더가 늦게 붙고(iCloud) settings.json이 아직 없으면, 기본값 설정을 그 폴더에 쓰지 않는다", async () => {
    const { page, context } = await openApp(browser, { rootUnavailable: true, files: { [D14]: "- [ ] a\n" } });
    await page.clock.runFor(1000);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(10_000);
    const settingsWrites = (await calls(page, "write_text")).filter((a) => a.path === "settings.json");
    assert.equal(settingsWrites.length, 0, J(settingsWrites));
    assert.equal((await fs(page))["settings.json"], undefined);
    // 사용자가 직접 바꾼 값은 쓴다
    await page.locator('[aria-label="항상 위에 고정"]').click();
    await page.clock.runFor(2000);
    assert.equal(JSON.parse((await fs(page))["settings.json"]).alwaysOnTop, false);
    await context.close();
  });

  await scenario("N5 창 투명도 적용이 한 번 실패하면 다시 보낸다(성공한 값은 다시 보내지 않는다)", async () => {
    const { page, context, errors } = await openApp(browser, {
      files: { [D14]: "- [ ] a\n", "settings.json": J({ opacity: 40 }) },
      globals: { __failOpacity: 1 },
    });
    await page.clock.runFor(3500);
    const sent = (await calls(page, "set_window_opacity")).map((a) => a.alpha);
    assert.equal(sent.length, 2, J(sent));
    assert.ok(Math.abs(sent[1] - 0.52) < 0.001);
    await page.clock.runFor(6000);
    assert.equal((await calls(page, "set_window_opacity")).length, 2, "성공한 값은 다시 보내지 않는다");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("N4 종료 대기(quit-waiting)가 오면 최소화한 작은 창도 펼쳐 띄운다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n" } });
    await page.evaluate(() => window.__emit("quit-waiting", null));
    await page.clock.runFor(10);
    assert.equal((await calls(page, "plugin:window|unminimize")).length, 1);
    assert.equal((await calls(page, "plugin:window|show")).length, 1);
    await context.close();
  });

  // ── 저장 실패 표시 유지 ──
  await scenario("R10-13 오늘 파일 저장 실패 중 ◀ 다른 날 저장이 성공해도 '저장 실패'가 남고, 회복되면 오늘 글이 1번 저장", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", [D13]: "- [ ] b\n", "settings.json": '{"carryOver":"keep"}' } });
    await page.evaluate((p) => (window.__failPaths = [p]), D14);
    await itemText(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("X");
    await page.clock.runFor(2000);
    await page.locator('[aria-label="이전 날"]').click();
    await page.clock.runFor(500);
    await itemText(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("Y");
    await page.clock.runFor(2500);
    assert.match(await footText(page), /저장 실패/);
    await page.evaluate(() => (window.__failPaths = []));
    await page.clock.runFor(15000);
    assert.equal((await fs(page))[D14], "- [ ] aX\n");
    await context.close();
  });

  // ── AI 연결 ──
  await scenario("R10-14 설치 중 설정을 닫음 → 설치 실패 → 다시 열면 실패 이유가 보인다", async () => {
    const { page, context } = await openApp(browser, { globals: { __installDelay: 3000, __installFail: "Claude를 열지 못했어요(모의)" } });
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(50);
    await page.locator('[data-action="connect-claude-desktop"]').click();
    await page.clock.runFor(200);
    await page.locator('[data-action="close"]').click();
    await page.clock.runFor(4000);
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(50);
    assert.match((await page.locator(".connect").innerText()).replace(/\s+/g, " "), /모의/);
    // 결과를 본 뒤 닫았다 열면 지난 안내는 지운다
    await page.locator('[data-action="close"]').click();
    await page.clock.runFor(50);
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(50);
    assert.doesNotMatch((await page.locator(".connect").innerText()).replace(/\s+/g, " "), /모의/);
    await context.close();
  });
}
