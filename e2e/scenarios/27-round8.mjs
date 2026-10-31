// 라운드 8 QA(QA8-01·02, 의심 AC3·AC5·AC6·AC10·ST2)와 7차 코드 리뷰(N4·N5·N6)에서 나온 경우들. QA8 시나리오를 옮기고 리뷰 항목을 더했다
import assert from "node:assert/strict";
import { calls, caretToEnd, fs, isWin, openApp, scenario, status, texts } from "../harness.mjs";

const D13 = "daily/2026-10-13.md";
const D14 = "daily/2026-10-14.md";
const D15 = "daily/2026-10-15.md";
const J = JSON.stringify;
const BEFORE = "2026-10-14T23:59:30";
const FAILED = "저장 실패 — 다시 시도합니다";

const st = (carryOver, last = "2026-10-14") => J({ carryOver, lastRolloverDate: last });
const addInput = (page, list = "today") => page.locator(`[data-list="${list}"] .add input`);
const text = (page, i, list = "today") => page.locator(`[data-list="${list}"] .item .text`).nth(i);
const footText = async (page) => (await page.locator(".foot").textContent()).replace(/\s+/g, " ").trim();
const quit = async (page) => {
  await page.evaluate(() => window.__emit("quit-requested", null));
  await page.clock.runFor(3000);
};
const btn = (page, action) => page.locator(`[data-action="connect-${action}"]`);
const label = async (page, action) => (await btn(page, action).textContent()).trim();
const connectText = async (page) => (await page.locator(".connect").innerText()).replace(/\s+/g, " ");

async function openSettings(page, { clipboardFails = false } = {}) {
  await page.evaluate((fails) => {
    navigator.clipboard.writeText = async (t) => {
      if (fails) throw new Error("denied");
      window.__copied = t;
    };
  }, clipboardFails);
  await page.locator('[aria-label="설정"]').click();
  await page.clock.runFor(10);
}

async function draftAtMidnight(page, readFault) {
  await addInput(page).click();
  await page.keyboard.type("쓰다만");
  await page.evaluate(([key, p]) => (window[key] = [p]), [readFault, D15]);
  await page.clock.runFor(60_000);
}

export default async function (browser) {
  // ── QA8-01: 자정에 새 날을 읽지 못하면 입력칸 글은 떠나는 날에 넣는다(예전 규칙). 새 날을 못 읽으면 자정 정리도 미뤄지므로 읽히면 함께 옮겨진다 ──
  await scenario("QA8-01[next-day·잠깐 못 읽음] 입력칸 글은 떠나는 날에 남고, 새 날이 읽히면 정리로 새 날에 옮겨진다", async () => {
    const { page, context, errors } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("next-day"), [D14]: "- [ ] 원래\n", [D15]: "- [ ] 미리\n" },
    });
    await draftAtMidnight(page, "__flakyReads");
    assert.match((await fs(page))[D14] ?? "", /- \[ \] 쓰다만/);
    await page.evaluate(() => (window.__flakyReads = []));
    await page.clock.runFor(10_000);
    const f = await fs(page);
    assert.match(f[D15] ?? "", /- \[ \] 쓰다만/);
    assert.match(f[D15] ?? "", /- \[ \] 원래/);
    assert.doesNotMatch(f[D14] ?? "", /- \[ \] /);
    assert.ok((await texts(page, "today")).includes("쓰다만"));
    assert.equal(JSON.parse(f["settings.json"]).lastRolloverDate, "2026-10-15");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("QA8-01[next-day·계속 못 읽음(UTF-8 아님)] 그대로 종료해도 입력칸 글은 떠나는 날 파일에 남고, 정리는 미뤄진다", async () => {
    const { page, context, errors } = await openApp(browser, {
      now: BEFORE,
      files: { "settings.json": st("next-day"), [D14]: "- [ ] 원래\n", [D15]: "- [ ] 미리\n" },
    });
    await draftAtMidnight(page, "__badReads");
    await page.clock.runFor(30_000);
    await quit(page);
    const f = await fs(page);
    assert.equal(f[D14], "- [ ] 원래\n- [ ] 쓰다만\n");
    assert.equal(f[D15], "- [ ] 미리\n");
    assert.equal(JSON.parse(f["settings.json"]).lastRolloverDate, "2026-10-14");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("QA8-01[keep·잠깐 못 읽음] 그대로 남기기면 입력칸 글은 떠나는 날에 남는다", async () => {
    const { page, context } = await openApp(browser, { now: BEFORE, files: { "settings.json": st("keep"), [D14]: "- [ ] 원래\n" } });
    await draftAtMidnight(page, "__flakyReads");
    await page.evaluate(() => (window.__flakyReads = []));
    await page.clock.runFor(10_000);
    await quit(page);
    assert.equal((await fs(page))[D14], "- [ ] 원래\n- [ ] 쓰다만\n");
    await context.close();
  });

  // ── QA8-02: 폴더를 열 수 없는 동안 자정 정리가 바꾼 lastRolloverDate는 사용자 설정이 아니다 ──
  for (const [reason, unavailableAtMidnight] of [["kept", true], ["sourceUnavailable", true], ["kept", false]]) {
    await scenario(`QA8-02[${reason}${unavailableAtMidnight ? "" : " 대조: 자정에 폴더가 열려 있었음"}] 그대로 남기기 창에서 자정 뒤 다른 폴더(다음 날로, 10/12까지 정리)로 바꾸면 그 폴더의 밀린 일이 정리된다`, async () => {
      const { page, context, errors } = await openApp(browser, {
        now: BEFORE,
        files: { "settings.json": J({ carryOver: "keep", lastRolloverDate: "2026-10-14", opacity: 100 }), [D14]: "- [ ] 원래\n" },
      });
      if (unavailableAtMidnight) await page.evaluate(() => window.__setRootAvailable(false));
      await page.clock.runFor(60_000);
      if (!unavailableAtMidnight) await page.evaluate(() => window.__setRootAvailable(false));
      await page.clock.runFor(4000);
      await page.evaluate(() => {
        window.__setRootAvailable(true);
        for (const k of Object.keys(window.__mockFs)) window.__setFile(k, null);
        window.__setFile("settings.json", JSON.stringify({ carryOver: "next-day", lastRolloverDate: "2026-10-12", opacity: 60 }));
        window.__setFile("daily/2026-10-13.md", "- [ ] 밀린일\n");
        sessionStorage.setItem("__rootPath", "/Users/me/Dropbox/todo");
      });
      await page.evaluate((r) => window.__emit("data-root-changed", { copied: false, reason: r }), reason);
      await page.clock.runFor(3000).catch(() => {});
      await page.waitForSelector(".foot");
      await page.clock.runFor(5000);
      const f = await fs(page);
      const s = JSON.parse(f["settings.json"]);
      assert.equal(s.carryOver, "next-day");
      assert.equal(s.opacity, 60);
      assert.equal(s.lastRolloverDate, "2026-10-15");
      assert.doesNotMatch(f[D13] ?? "", /- \[ \] 밀린일/);
      assert.match(f[D15] ?? "", /- \[ \] 밀린일/);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }

  // ── AI 도구에 연결 (리뷰 N4, QA8 의심 AC3·AC5·AC6·AC10) ──
  await scenario("AC3 연결 정보를 읽지 못하면 버튼이 꺼진 이유를 보여 준다", async () => {
    const { page, context } = await openApp(browser, { globals: { __aiInfoFail: "실행 파일 경로를 알 수 없어요(모의)" } });
    await openSettings(page);
    assert.equal(await btn(page, "claude-code").isDisabled(), true);
    assert.equal(await btn(page, "codex").isDisabled(), true);
    assert.match(await connectText(page), /연결 정보를 읽지 못했어요/);
    await context.close();
  });

  await scenario("AC5 Claude 데스크톱: 누르는 동안 다시 눌러도 한 번만 부르고, 끝나면 Claude에서 확인하라고 알린다", async () => {
    const { page, context, errors } = await openApp(browser, { globals: { __installDelay: 300 } });
    await openSettings(page);
    await btn(page, "claude-desktop").click();
    assert.equal(await btn(page, "claude-desktop").isDisabled(), true);
    await btn(page, "claude-desktop").click({ force: true });
    await page.clock.runFor(400);
    assert.equal((await calls(page, "install_claude_desktop")).length, 1);
    assert.equal(await btn(page, "claude-desktop").isDisabled(), false);
    assert.match(await connectText(page), /Claude에서 설치를 확인해 주세요/);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("AC5 Claude 데스크톱: 실패하면 '열지 못함'과 함께 Rust가 준 이유를 보여 준다", async () => {
    const { page, context } = await openApp(browser, { globals: { __installFail: "확장 파일을 만들지 못했어요: 디스크가 가득 찼어요" } });
    await openSettings(page);
    await btn(page, "claude-desktop").click();
    await page.clock.runFor(10);
    assert.equal(await label(page, "claude-desktop"), "열지 못함");
    assert.match(await connectText(page), /확장 파일을 만들지 못했어요: 디스크가 가득 찼어요/);
    assert.doesNotMatch(await connectText(page), /설치를 확인해 주세요/);
    await page.clock.runFor(1600);
    assert.equal(await label(page, "claude-desktop"), "Claude 데스크톱");
    await context.close();
  });

  await scenario("AC6 복사에 실패하면 명령을 화면에 보여 줘 직접 고를 수 있게 한다", async () => {
    const { page, context } = await openApp(browser);
    await openSettings(page, { clipboardFails: true });
    await btn(page, "codex").click();
    await page.clock.runFor(10);
    assert.equal(await label(page, "codex"), "복사 실패");
    const cmd = page.locator(".connect .command");
    assert.equal(
      (await cmd.textContent()).trim(),
      isWin
        ? `codex mcp add aru -- "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\aru.exe" mcp`
        : "codex mcp add aru -- /Applications/Aru.app/Contents/MacOS/aru mcp",
    );
    assert.equal(await cmd.evaluate((el) => getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect), "text");
    // 고르는 동안 사라지지 않는다
    await page.clock.runFor(5000);
    assert.equal(await cmd.count(), 1);
    await context.close();
  });

  await scenario("AC10 'AI·명령어로 추가 허용'이 꺼져 있으면 연결 칸에 조용히 알린다", async () => {
    const { page, context } = await openApp(browser, { files: { "settings.json": J({ allowExternalAdd: false }) } });
    await openSettings(page);
    assert.match(await connectText(page), /AI·명령어로 추가가 꺼져 있어요/);
    await context.close();
    const on = await openApp(browser);
    await openSettings(on.page);
    assert.doesNotMatch(await connectText(on.page), /꺼져 있어요/);
    await on.context.close();
  });

  await scenario("AI 연결 안내: 명령은 터미널에서 실행하고, 열려 있던 도구는 다시 시작하라고 알린다", async () => {
    const { page, context } = await openApp(browser);
    await openSettings(page);
    const t = await connectText(page);
    assert.doesNotMatch(t, /대화창에 붙여넣으면/);
    assert.match(t, /터미널/);
    assert.match(t, /다시 시작/);
    await context.close();
  });

  await scenario("AI 연결: 설정을 열 때마다 Claude 데스크톱이 깔려 있는지 다시 본다", async () => {
    const { page, context } = await openApp(browser, { globals: { __claudeDesktop: false } });
    await openSettings(page);
    assert.equal(await btn(page, "claude-desktop").count(), 0);
    await page.locator('[data-action="close"]').click();
    await page.evaluate(() => (window.__claudeDesktop = true));
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(10);
    assert.equal(await btn(page, "claude-desktop").count(), 1);
    await context.close();
  });

  // ── 리뷰 N5: 달력에 없는 날짜를 보여 달라는 요청은 무시한다 ──
  await scenario("N5 show-date 2026-02-31은 무시하고 그 파일을 만들지 않는다", async () => {
    const { page, context } = await openApp(browser);
    await page.evaluate(() => window.__emit("show-date", "2026-02-31"));
    await page.clock.runFor(300);
    assert.equal(await page.locator(".datebar .date").textContent(), "10월 14일 (수)");
    await addInput(page).fill("x");
    await addInput(page).press("Enter");
    await page.clock.runFor(1500);
    assert.ok(!Object.keys(await fs(page)).some((k) => k.includes("2026-02-31")));
    await context.close();
  });

  // ── 리뷰 N6: 폴더를 옮기는 동안 종료를 누르면 끝난 뒤 끈다고 알린다 ──
  await scenario("N6 종료가 폴더 옮기기를 기다리는 동안(quit-waiting) 창 아래에 알린다", async () => {
    const { page, context } = await openApp(browser);
    await page.evaluate(() => window.__emit("quit-waiting", null));
    await page.clock.runFor(10);
    assert.match(await footText(page), /폴더를 옮기는 중이라 끝나면 종료해요/);
    // 오래 걸려도(최대 60초) 그동안 사라지지 않는다
    await page.clock.runFor(30_000);
    assert.match(await footText(page), /폴더를 옮기는 중이라 끝나면 종료해요/);
    await context.close();
  });

  // ── QA8 의심 ST2: 재시도가 쓰는 중이어도 성공하기 전까지는 '저장 실패'다 ──
  await scenario("ST2 실패한 언젠가의 재시도가 쓰는 중일 때 오늘 저장이 끝나도 '저장 실패'를 가리지 않는다", async () => {
    const { page, context } = await openApp(browser, { files: { [D14]: "- [ ] a\n", "someday.md": "- [ ] s\n" } });
    await page.evaluate(() => (window.__failPaths = ["someday.md"]));
    await text(page, 0, "someday").click();
    await caretToEnd(page);
    await page.keyboard.type("1");
    await page.clock.runFor(1500);
    await page.evaluate(() => {
      window.__failPaths = [];
      window.__hangPaths = ["someday.md"];
    });
    await page.clock.runFor(5000);
    await text(page, 0).click();
    await caretToEnd(page);
    await page.keyboard.type("2");
    await page.clock.runFor(1500);
    assert.equal((await fs(page))[D14], "- [ ] a2\n");
    assert.equal(await status(page), FAILED);
    await page.evaluate(() => window.__releasePaths());
    await page.clock.runFor(500);
    assert.match(await status(page), /저장됨/);
    assert.equal((await fs(page))["someday.md"], "- [ ] s1\n");
    await context.close();
  });
}
