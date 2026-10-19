import assert from "node:assert/strict";
import { calls, fs, openApp, reload, scenario, status, texts, caretToEnd } from "../harness.mjs";

const TODAY = "daily/2026-10-14.md";
const YESTERDAY = "daily/2026-10-13.md";
const BIG = { hash: "#overview", viewport: { width: 1180, height: 760 } };

const writesTo = async (page, path) => (await calls(page, "write_text")).filter((a) => a.path === path);

async function add(page, text, list = "today") {
  const input = page.locator(`[data-list="${list}"] .add input`);
  await input.fill(text);
  await input.press("Enter");
  await page.clock.runFor(10);
}

export default async function (browser) {
  // UI-01: 파일 하나를 못 읽어도 나머지는 계속 저장되고, 못 읽은 파일은 절대 덮어쓰지 않는다
  await scenario("someday.md를 못 읽어도 오늘 할 일은 저장되고, 창 아래에 알리며, someday.md는 덮어쓰지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "someday.md": "깨진 파일" },
      globals: { __badReads: ["someday.md"] },
    });
    await add(page, "중요한 일");
    await page.clock.runFor(1500);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 중요한 일\n");
    assert.equal(await status(page), "읽지 못한 파일이 있어요: someday.md");
    // 못 읽은 목록에는 새로 적을 수 없다(적어도 저장되지 않으므로)
    assert.equal(await page.locator('[data-list="someday"] .add input').count(), 0);
    assert.deepEqual(await writesTo(page, "someday.md"), []);
    assert.equal((await fs(page))["someday.md"], "깨진 파일");
    await context.close();
  });

  await scenario("settings.json을 못 읽어도 할 일은 저장되고, 설정을 바꿔도 settings.json은 덮어쓰지 않는다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "settings.json": "{}" },
      globals: { __badReads: ["settings.json"] },
    });
    await add(page, "일");
    assert.equal((await fs(page))[TODAY], "- [ ] 일\n");
    await page.locator('[aria-label="설정"]').click();
    await page.locator('[data-setting="sortChecked"]').click();
    await page.clock.runFor(1500);
    assert.deepEqual(await writesTo(page, "settings.json"), []);
    assert.equal(await status(page), "읽지 못한 파일이 있어요: settings.json");
    await context.close();
  });

  await scenario("못 읽는 지난 날짜로 가면 적을 수 없고 알림이 뜨며, 오늘로 돌아오면 평소대로 저장된다", async () => {
    const { page, context } = await openApp(browser, {
      files: { [YESTERDAY]: "깨짐", "settings.json": '{"carryOver":"keep"}' },
      globals: { __badReads: [YESTERDAY] },
    });
    await page.locator('[aria-label="이전 날"]').click();
    await page.clock.runFor(10);
    assert.equal(await page.locator('[data-list="today"] .add input').count(), 0);
    assert.equal(await status(page), `읽지 못한 파일이 있어요: ${YESTERDAY}`);
    await page.locator('[aria-label="다음 날"]').click();
    await page.clock.runFor(10);
    await add(page, "오늘 일");
    assert.equal((await fs(page))[TODAY], "- [ ] 오늘 일\n");
    assert.equal(await status(page), "저장됨");
    assert.deepEqual(await writesTo(page, YESTERDAY), []);
    await context.close();
  });

  await scenario("못 읽던 파일이 읽히게 되면(인코딩을 고침) 다음 확인 때 목록이 채워지고 알림이 사라진다", async () => {
    const { page, context } = await openApp(browser, {
      files: { "someday.md": "- [ ] 여권\n" },
      globals: { __badReads: ["someday.md"] },
    });
    assert.deepEqual(await texts(page, "someday"), []);
    await page.evaluate(() => (window.__badReads = []));
    await page.clock.runFor(3100);
    assert.deepEqual(await texts(page, "someday"), ["여권"]);
    assert.equal(await status(page), "저장됨");
    await context.close();
  });

  await scenario("모아보기: 못 읽는 파일이 있어도 창이 뜨고, 다른 날은 저장되며, 알림이 뜬다", async () => {
    const { page, context } = await openApp(browser, {
      ...BIG,
      files: { "daily/2026-10-20.md": "깨짐", "daily/2026-10-21.md": "- [ ] 수요일\n", "someday.md": "깨짐" },
      globals: { __badReads: ["daily/2026-10-20.md", "someday.md"] },
    });
    assert.equal((await page.locator('.cell[data-date="2026-10-21"] .mi').textContent()).trim(), "수요일");
    await add(page, "모아보기에서", "overview");
    assert.equal((await fs(page))[TODAY], "- [ ] 모아보기에서\n");
    assert.match(await status(page), /^읽지 못한 파일이 있어요: /);
    assert.match(await status(page), /someday\.md/);
    await page.locator('.cell[data-date="2026-10-20"]').click();
    await page.clock.runFor(10);
    assert.equal(await page.locator('[data-list="overview"] .add input').count(), 0);
    assert.deepEqual(await writesTo(page, "daily/2026-10-20.md"), []);
    await context.close();
  });

  // 샌드박스: 사용자가 고른 저장 폴더를 열 수 없을 때(외장 디스크 빠짐, iCloud가 늦게 붙음)
  await scenario("저장 폴더를 열 수 없으면 아무것도 쓰지 않고 고친 내용은 창에 두며, 폴더가 돌아오면 합쳐서 저장한다", async () => {
    const { page, context } = await openApp(browser, { rootUnavailable: true });
    assert.equal(await status(page), "저장 폴더를 열 수 없어요");
    assert.equal(await page.locator('.foot [data-action="repick-folder"]').count(), 1);
    assert.equal(await page.locator('.foot [data-action="default-folder"]').count(), 1);
    await add(page, "폴더 없을 때 적은 일");
    await page.clock.runFor(6000);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(10);
    assert.deepEqual(await texts(page, "today"), ["폴더 없을 때 적은 일"]);
    assert.deepEqual(await calls(page, "write_text"), [], "폴더를 열 수 없는데 쓰기를 시도했다");
    assert.equal(await status(page), "저장 폴더를 열 수 없어요");
    // 그 사이 다른 기기가 같은 파일에 적었다
    await page.evaluate((p) => window.__setFile(p, "- [ ] 다른 기기에서\n"), TODAY);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(3100);
    assert.equal((await fs(page))[TODAY], "- [ ] 다른 기기에서\n- [ ] 폴더 없을 때 적은 일\n");
    assert.deepEqual(await texts(page, "today"), ["다른 기기에서", "폴더 없을 때 적은 일"]);
    assert.equal(await status(page), "저장됨");
    assert.equal(await page.locator('.foot [data-action="repick-folder"]').count(), 0);
    await context.close();
  });

  await scenario("쓰는 중에 폴더가 사라지면 알림이 뜨고, 다시 붙으면(창을 다시 볼 때) 바깥 변경과 합쳐 저장한다", async () => {
    const { page, context } = await openApp(browser, { files: { [TODAY]: "- [ ] 하나\n" } });
    const writesBefore = (await calls(page, "write_text")).length;
    await page.evaluate(() => window.__setRootAvailable(false));
    await page.locator('[data-list="today"] .item .text').click();
    await caretToEnd(page);
    await page.keyboard.type(" 고침");
    await page.clock.runFor(1100);
    assert.equal(await status(page), "저장 폴더를 열 수 없어요");
    await page.clock.runFor(6000);
    assert.equal((await calls(page, "write_text")).length - writesBefore, 1, "폴더가 없다는 걸 안 뒤에도 계속 쓰려 했다");
    await page.evaluate((p) => window.__setFile(p, "- [ ] 하나\n- [ ] 다른 기기\n"), TODAY);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.clock.runFor(10);
    assert.equal((await fs(page))[TODAY], "- [ ] 하나 고침\n- [ ] 다른 기기\n");
    assert.equal(await status(page), "저장됨");
    await context.close();
  });

  await scenario("폴더가 없는 동안 다른 날로 오가며 적은 것도 폴더가 돌아오면 각 파일에 합쳐 저장된다", async () => {
    const { page, context } = await openApp(browser, { rootUnavailable: true, files: { [YESTERDAY]: "- [ ] 원래\n", "settings.json": '{"carryOver":"keep"}' } });
    await add(page, "오늘 적음");
    await page.locator('[aria-label="이전 날"]').click();
    await page.clock.runFor(10);
    await add(page, "어제 적음");
    await page.locator('[aria-label="다음 날"]').click();
    await page.clock.runFor(10);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.clock.runFor(3100);
    const files = await fs(page);
    assert.equal(files[TODAY], "- [ ] 오늘 적음\n");
    assert.equal(files[YESTERDAY], "- [ ] 원래\n- [ ] 어제 적음\n");
    await context.close();
  });

  await scenario("'기본 폴더 쓰기'를 누르면 기본 폴더로 바꾸고, 그동안 적은 일을 잃지 않는다", async () => {
    const { page, context } = await openApp(browser, { rootUnavailable: true });
    await add(page, "잃으면 안 됨");
    await page.locator('.foot [data-action="default-folder"]').click();
    await page.clock.runFor(10);
    await page.waitForSelector(".foot");
    await page.clock.runFor(100);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("__rootUnavailable")), "0", "reset_data_root를 부르지 않았다");
    assert.equal((await fs(page))[TODAY], "- [ ] 잃으면 안 됨\n");
    await reload(page);
    assert.deepEqual(await texts(page, "today"), ["잃으면 안 됨"]);
    assert.equal(await status(page), "저장됨");
    await context.close();
  });

  await scenario("'폴더 다시 고르기'에서 폴더를 바꾸지 못하면 그 이유를 창 아래에 보여 준다", async () => {
    const { page, context, errors } = await openApp(browser, { rootUnavailable: true });
    await page.evaluate(() => {
      window.__pickResult = "/Volumes/USB/todo";
      window.__failSetRoot = "폴더에 쓸 권한이 없어요";
    });
    await page.locator('.foot [data-action="repick-folder"]').click();
    await page.clock.runFor(10);
    assert.equal(await status(page), "폴더를 바꾸지 못했어요: 폴더에 쓸 권한이 없어요");
    assert.deepEqual(errors.filter((e) => /Unhandled|권한/.test(e)), []);
    await context.close();
  });

  await scenario("설정의 폴더 변경이 실패해도 조용히 삼키지 않고 창 아래에 보여 준다", async () => {
    const { page, context, errors } = await openApp(browser);
    await page.locator('[aria-label="설정"]').click();
    await page.evaluate(() => {
      window.__pickResult = "/Users/me/Dropbox/todo";
      window.__failSetRoot = "폴더를 찾을 수 없어요";
    });
    await page.locator('[data-action="change-folder"]').click();
    await page.clock.runFor(10);
    assert.equal(await status(page), "폴더를 바꾸지 못했어요: 폴더를 찾을 수 없어요");
    assert.deepEqual(errors.filter((e) => /Unhandled|찾을 수 없어요/.test(e)), []);
    await context.close();
  });

  await scenario("모아보기도 폴더를 열 수 없으면 알리고 아무것도 쓰지 않는다", async () => {
    const { page, context } = await openApp(browser, { ...BIG, rootUnavailable: true });
    assert.equal(await status(page), "저장 폴더를 열 수 없어요");
    await add(page, "모아보기 일", "overview");
    await page.clock.runFor(2000);
    assert.deepEqual(await calls(page, "write_text"), []);
    await page.evaluate(() => window.__setRootAvailable(true));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.clock.runFor(3100);
    assert.equal((await fs(page))[TODAY], "- [ ] 모아보기 일\n");
    await context.close();
  });
}
