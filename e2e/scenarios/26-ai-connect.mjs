import assert from "node:assert/strict";
import { calls, isWin, openApp, scenario } from "../harness.mjs";

const ARU = isWin ? "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\aru.exe" : "/Applications/Aru.app/Contents/MacOS/aru";
// Windows는 PowerShell·cmd 둘 다에서 되도록 늘 큰따옴표로 감싼다
const QUOTED_ARU = isWin ? `"${ARU}"` : ARU;
const SPACED = isWin ? "C:\\Users\\me\\My Apps\\aru.exe" : "/Users/me/My Apps/Aru.app/Contents/MacOS/aru";

async function openSettings(page) {
  // 실제 클립보드 대신 마지막으로 복사한 글자를 남긴다
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.__copied = text;
    };
  });
  await page.locator('[aria-label="설정"]').click();
  await page.clock.runFor(10);
}

export default async function (browser) {
  await scenario("AI 연결: Claude Code·Codex 버튼은 등록 명령을 복사하고 잠깐 '복사됨'으로 바뀐다", async () => {
    const { page, context, errors } = await openApp(browser);
    await openSettings(page);

    const claude = page.locator('[data-action="connect-claude-code"]');
    await claude.click();
    await page.clock.runFor(10);
    assert.equal(await page.evaluate(() => window.__copied), `claude mcp add --scope user aru -- ${QUOTED_ARU} mcp`);
    assert.equal((await claude.textContent()).trim(), "복사됨 ✓");
    await page.clock.runFor(1600);
    assert.equal((await claude.textContent()).trim(), "Claude Code");

    await page.locator('[data-action="connect-codex"]').click();
    await page.clock.runFor(10);
    assert.equal(await page.evaluate(() => window.__copied), `codex mcp add aru -- ${QUOTED_ARU} mcp`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("AI 연결: 경로에 빈칸이 있으면 따옴표로 감싼다", async () => {
    const { page, context } = await openApp(browser, { globals: { __aruCommand: SPACED } });
    await openSettings(page);
    await page.locator('[data-action="connect-codex"]').click();
    await page.clock.runFor(10);
    assert.equal(
      await page.evaluate(() => window.__copied),
      isWin ? `codex mcp add aru -- "${SPACED}" mcp` : `codex mcp add aru -- '${SPACED}' mcp`,
    );
    await context.close();
  });

  await scenario("AI 연결: Claude 데스크톱 버튼은 확장 설치를 부르고, Claude 앱이 없으면 버튼이 없다", async () => {
    const { page, context } = await openApp(browser);
    await openSettings(page);
    await page.locator('[data-action="connect-claude-desktop"]').click();
    await page.clock.runFor(10);
    assert.equal((await calls(page, "install_claude_desktop")).length, 1);
    await context.close();

    const none = await openApp(browser, { globals: { __claudeDesktop: false } });
    await openSettings(none.page);
    assert.equal(await none.page.locator('[data-action="connect-claude-desktop"]').count(), 0);
    assert.equal(await none.page.locator('[data-action="connect-claude-code"]').count(), 1);
    await none.context.close();
  });

  await scenario("AI 연결: 복사에 실패하면 '복사됨'을 띄우지 않고 실패를 알린다", async () => {
    const { page, context } = await openApp(browser);
    await openSettings(page);
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error("denied");
      };
    });
    const claude = page.locator('[data-action="connect-claude-code"]');
    await claude.click();
    await page.clock.runFor(10);
    assert.equal((await claude.textContent()).trim(), "복사 실패");
    await page.clock.runFor(1600);
    assert.equal((await claude.textContent()).trim(), "Claude Code");
    await context.close();
  });
}
