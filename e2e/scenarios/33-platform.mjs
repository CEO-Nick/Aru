// 맥·Windows에서 달라지는 문구·경로·명령. 기본은 맥 기대값으로, E2E_PLATFORM=win이면 Windows 기대값으로 돈다
import assert from "node:assert/strict";
import { calls, isWin, openApp, scenario } from "../harness.mjs";
const DEFAULT_LABEL = isWin ? "기본 폴더 (~\\Documents\\Aru)" : "기본 폴더 (Aru 안)";

const HOME = isWin ? "C:\\Users\\me" : "/Users/me";
const CLOUD = isWin ? `${HOME}\\OneDrive\\할일` : `${HOME}/Library/Mobile Documents/com~apple~CloudDocs/할일`;

async function openSettings(page) {
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.__copied = text;
    };
  });
  await page.locator('[aria-label="설정"]').click();
  await page.clock.runFor(10);
}

const feedbackOs = async (page) => {
  await page.locator('[data-action="feedback"]').click();
  await page.clock.runFor(10);
  const [opened] = await calls(page, "plugin:opener|open_url");
  return new URL(opened.url).searchParams.get("os");
};

export default async function (browser) {
  await scenario(`[${isWin ? "Windows" : "맥"}] 폴더 열기 버튼은 ${isWin ? "탐색기" : "Finder"}라고 부른다`, async () => {
    const { page, context, errors } = await openApp(browser);
    await openSettings(page);
    const reveal = page.locator('[data-action="reveal-folder"]');
    assert.equal((await reveal.textContent()).trim(), isWin ? "탐색기에서 열기" : "Finder에서 열기");
    await reveal.click();
    await page.clock.runFor(10);
    assert.equal((await calls(page, "plugin:opener|reveal_item_in_dir")).length, 1);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario(`[${isWin ? "Windows" : "맥"}] AI 연결 명령은 그 OS 터미널에 붙여넣을 수 있게 감싼다`, async () => {
    const { page, context } = await openApp(browser);
    await openSettings(page);
    await page.locator('[data-action="connect-claude-code"]').click();
    await page.clock.runFor(10);
    assert.equal(
      await page.evaluate(() => window.__copied),
      isWin
        ? `claude mcp add --scope user aru -- "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\aru.exe" mcp`
        : "claude mcp add --scope user aru -- /Applications/Aru.app/Contents/MacOS/aru mcp",
    );
    await context.close();
  });

  await scenario(`[${isWin ? "Windows" : "맥"}] 클라우드 폴더는 ${isWin ? "OneDrive" : "iCloud Drive"}로, 기본 폴더는 이름으로 보인다`, async () => {
    const { page, context } = await openApp(browser);
    await openSettings(page);
    const path = page.locator(".settings .path");
    assert.equal(await path.textContent(), DEFAULT_LABEL);
    assert.equal(
      await path.getAttribute("title"),
      isWin ? "C:\\Users\\me\\Documents\\Aru" : "/Users/me/Library/Application Support/dev.aruu.aru",
    );
    await page.locator('[data-action="close"]').click();

    await page.evaluate((p) => sessionStorage.setItem("__rootPath", p), CLOUD);
    await openSettings(page);
    assert.equal(await path.textContent(), isWin ? "OneDrive\\할일" : "iCloud Drive/할일");
    assert.equal(await path.getAttribute("title"), CLOUD);
    await context.close();
  });

  await scenario(`[${isWin ? "Windows" : "맥"}] 의견 보내기에 OS 버전이 붙고, 못 읽으면 OS 이름만 붙는다`, async () => {
    const { page, context } = await openApp(browser);
    await openSettings(page);
    assert.equal(await feedbackOs(page), isWin ? "Windows 11 (26100)" : "macOS 15.1");
    await context.close();

    const failed = await openApp(browser, { globals: { __osVersionFail: true } });
    await openSettings(failed.page);
    assert.equal(await feedbackOs(failed.page), isWin ? "Windows" : "macOS");
    await failed.context.close();
  });

  await scenario(`[${isWin ? "Windows" : "맥"}] 제목 막대 왼쪽 신호등 자리는 맥에서만 비운다`, async () => {
    const { page, context } = await openApp(browser);
    const pad = await page.locator(".titlebar").evaluate((el) => getComputedStyle(el).paddingLeft);
    assert.equal(pad, isWin ? "10px" : "76px");
    assert.equal(await page.locator(".titlebar").getAttribute("data-os"), isWin ? "windows" : "macos");
    await context.close();
  });
}
