// 실제 화면을 크롬으로 열어 사람이 하듯 조작하고 결과(화면·저장 파일)를 확인하는 E2E 도구
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright-core";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const mockScript = readFileSync(new URL("./mockTauri.js", import.meta.url), "utf8");

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
  { files = {}, now = "2026-10-14T10:00:00", hash = "", viewport = { width: 320, height: 470 }, pendingUpdate = null } = {},
) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(now) });
  await page.addInitScript(`window.__initialFiles = ${JSON.stringify(files)};`);
  await page.addInitScript(`window.__pendingUpdate = ${JSON.stringify(pendingUpdate)};`);
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
