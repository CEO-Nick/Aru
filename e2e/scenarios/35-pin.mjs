import assert from "node:assert/strict";
import { calls, fs, openApp, scenario } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
const pins = async (page) => (await calls(page, "plugin:window|set_always_on_top")).map((a) => a.value);
const settingsOf = async (page) => JSON.parse((await fs(page))["settings.json"] ?? "null");

// 핀을 끈 뒤에는 창이 한 번이라도 다시 '항상 위'로 올라가면 안 된다.
// 그 사이 다른 앱을 누르면 Aru가 뒤로 가지 않는다
async function offStaysOff(globals) {
  const { page, context } = await openApp(browser, {
    files: { [TODAY]: "- [ ] 하나\n", "settings.json": JSON.stringify({ alwaysOnTop: true, opacity: 100 }) },
    globals,
  });
  await page.clock.runFor(500);
  const before = (await pins(page)).length;
  await page.locator(".titlebar .pin").click();
  for (let i = 0; i < 40; i++) await page.clock.runFor(250);
  const after = (await pins(page)).slice(before);
  return { page, context, after };
}
let browser;

export default async function (b) {
  browser = b;
  await scenario("핀을 끄면 바로 '항상 위'가 풀리고, 10초 동안 다시 켜지지 않는다", async () => {
    const { page, context, after } = await offStaysOff();
    assert.equal(after[0], false, JSON.stringify(after));
    assert.ok(!after.includes(true), `다시 켜짐: ${JSON.stringify(after)}`);
    assert.equal((await settingsOf(page)).alwaysOnTop, false);
    await context.close();
  });

  await scenario("저장이 느린 폴더(iCloud 등)에서도 핀을 끈 뒤 다시 켜지지 않는다", async () => {
    const { page, context, after } = await offStaysOff({ __writeDelay: 4000, __readDelay: 300 });
    assert.equal(after[0], false, JSON.stringify(after));
    assert.ok(!after.includes(true), `다시 켜짐: ${JSON.stringify(after)}`);
    await context.close();
  });
}
