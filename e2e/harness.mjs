// 실제 화면을 크롬으로 열어 사람이 하듯 조작하고 결과(화면·저장 파일)를 확인하는 E2E 도구
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright-core";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const mockScript = readFileSync(new URL("./mockTauri.js", import.meta.url), "utf8");

/** E2E_PLATFORM=win: 모의 백엔드가 Windows 경로·명령·OS를 돌려준다(맥에서 돌리는 Windows 화면 시험) */
export const isWin = process.env.E2E_PLATFORM === "win";

export async function startServer() {
  const server = await createServer({
    root,
    configFile: `${root}/vite.config.ts`,
    server: { port: 1430, strictPort: true },
    logLevel: "error",
  });
  await server.listen();
  return server;
}

export async function openApp(
  browser,
  { files = {}, now = "2026-10-14T10:00:00", hash = "", viewport = { width: 320, height: 470 }, storage = {}, session = {}, globals = {}, rootUnavailable = false } = {},
) {
  const context = await browser.newContext({ viewport });
  // 컨텍스트에 두어 시나리오가 같은 컨텍스트에 따로 여는 창(빠른 입력·모아보기)도 같은 OS로 뜬다
  if (isWin) await context.addInitScript(`window.__platform = "windows";`);
  const page = await context.newPage();
  await page.clock.install({ time: new Date(now) });
  await page.addInitScript(`window.__initialFiles = ${JSON.stringify(files)};`);
  await page.addInitScript(
    `for (const [k, v] of Object.entries(${JSON.stringify(storage)})) localStorage.setItem(k, v);`,
  );
  // 창이 새로고침되기 전에 남겨 둔 값(폴더를 바꾼 뒤의 안내 등). 처음 열 때만 넣는다
  await page.addInitScript(
    `if (!sessionStorage.getItem("__e2eSession")) { sessionStorage.setItem("__e2eSession", "1"); for (const [k, v] of Object.entries(${JSON.stringify(session)})) sessionStorage.setItem(k, v); }`,
  );
  // 장애 주입용 전역값(__badReads·__readDelay 등). 모의 백엔드가 호출 때마다 읽는다
  await page.addInitScript(`Object.assign(window, ${JSON.stringify(globals)});`);
  if (rootUnavailable) await page.addInitScript(`sessionStorage.getItem("__rootUnavailable") ?? sessionStorage.setItem("__rootUnavailable", "1");`);
  await page.addInitScript(mockScript);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://localhost:1430/${hash}`);
  await page.waitForSelector(hash.startsWith("#quick") ? ".quick" : ".foot");
  await page.clock.runFor(10);
  return { page, context, errors };
}

export const fs = (page) => page.evaluate(() => window.__mockFs);
export const writes = (page) => page.evaluate(() => window.__writes);
export const calls = (page, name) =>
  page.evaluate((n) => window.__calls.filter(([c]) => c === n).map(([, a]) => a), name);
export const status = async (page) => (await page.locator(".foot .status").textContent()).trim();
/** 앱을 다시 켠다(새로고침). 파일은 sessionStorage에 남는다 */
export async function reload(page) {
  await page.reload();
  await page.waitForSelector(".foot");
  await page.clock.runFor(10);
}
/** 클립보드 붙여넣기를 흉내 낸다 */
export const paste = (locator, text) =>
  locator.evaluate((node, t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
/** 지금 커서가 있는 칸의 offset 위치로 커서를 보낸다 */
export const setCaret = (page, offset) =>
  page.evaluate((o) => {
    const el = document.activeElement;
    const r = document.createRange();
    r.setStart(el.firstChild ?? el, o);
    r.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  }, offset);

export const texts = (page, list) =>
  page.$$eval(`[data-list="${list}"] .item .text`, (els) => els.map((e) => e.textContent));

// 실제 앱은 WebKit(Safari 엔진)으로 그린다. E2E_BROWSER=webkit 이면 같은 엔진으로 돌린다
export function launch() {
  if (process.env.E2E_BROWSER === "webkit") return webkit.launch({ headless: true });
  return chromium.launch({ channel: "chrome", headless: true });
}

let failures = 0;
let passes = 0;

export async function scenario(name, fn) {
  try {
    await fn();
    passes++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`);
  }
}

export function summary() {
  console.log(`\n${passes} passed, ${failures} failed`);
  return failures;
}

/** 지금 커서가 있는 칸의 글자 끝으로 커서를 보낸다(맥 WebKit은 End 키로 가지 않는다) */
export async function caretToEnd(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || !el.isContentEditable) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}
