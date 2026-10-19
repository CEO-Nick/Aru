import assert from "node:assert/strict";
import { calls, openApp, reload, scenario, status, texts } from "../harness.mjs";

const DEFAULT_ROOT = "/Users/me/Library/Application Support/dev.aruu.aru";

/** 설정에서 폴더를 고르고, 바뀐 폴더로 창이 새로고침될 때까지 기다린다 */
async function switchTo(page, path, { copied }) {
  await page.evaluate(
    ([p, c]) => Object.assign(window, { __pickResult: p, __setRootCopied: c, __setRootEmits: true }),
    [path, copied],
  );
  const reloaded = page.waitForEvent("load");
  await page.locator('[data-action="change-folder"]').click();
  await page.clock.runFor(10);
  await reloaded;
  await page.waitForSelector(".foot");
  await page.clock.runFor(10);
}

export default async function (browser) {
  await scenario("설정의 저장 폴더: 기본 폴더는 이름으로, 고른 폴더는 ~로 줄여 보이고 전체 경로는 title에 있다", async () => {
    const { page, context, errors } = await openApp(browser);
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(10);
    const path = page.locator(".settings .path");
    assert.equal(await path.textContent(), "기본 폴더 (Aru 안)");
    assert.equal(await path.getAttribute("title"), DEFAULT_ROOT);

    await switchTo(page, "/Users/me/Dropbox/todo", { copied: true });
    await page.locator('[aria-label="설정"]').click();
    await page.clock.runFor(10);
    assert.equal(await path.textContent(), "~/Dropbox/todo");
    assert.equal(await path.getAttribute("title"), "/Users/me/Dropbox/todo");
    // 할 일을 옮겼으면 따로 알리지 않는다
    assert.equal(await status(page), "저장됨");

    await page.locator('[data-action="reveal-folder"]').click();
    await page.clock.runFor(10);
    assert.deepEqual(await calls(page, "plugin:opener|reveal_item_in_dir"), [{ paths: ["/Users/me/Dropbox/todo"] }]);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await scenario("이미 할 일이 있는 폴더로 바꾸면, 지금 할 일을 옮기지 않았다고 창 아래에 잠깐 알린다", async () => {
    const { page, context, errors } = await openApp(browser, { files: { "daily/2026-10-14.md": "- [ ] 지금 할 일\n" } });
    await page.locator('[aria-label="설정"]').click();
    await page.evaluate(() => window.__setFile("daily/2026-10-14.md", "- [ ] 새 폴더의 할 일\n"));
    await switchTo(page, "/Users/me/Dropbox/todo", { copied: false });
    assert.deepEqual(await texts(page, "today"), ["새 폴더의 할 일"]);
    assert.equal(
      await status(page),
      "이미 할 일이 있는 폴더라 지금 할 일은 옮기지 않았어요. 이전 폴더의 할 일은 그대로 있어요",
    );
    await page.clock.runFor(9_000);
    assert.notEqual(await status(page), "저장됨");
    await page.clock.runFor(1_500);
    assert.equal(await status(page), "저장됨");
    // 한 번만 알린다
    await reload(page);
    assert.equal(await status(page), "저장됨");
    assert.deepEqual(errors, []);
    await context.close();
  });
}
