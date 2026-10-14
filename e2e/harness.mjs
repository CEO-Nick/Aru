// 실제 화면을 크롬으로 열어 사람이 하듯 조작하고 결과(화면·저장 파일)를 확인하는 E2E 도구
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
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
  { files = {}, now = "2026-10-14T10:00:00", hash = "", viewport = { width: 320, height: 470 } } = {},
) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(now) });
  await page.addInitScript(`window.__initialFiles = ${JSON.stringify(files)};`);
  await page.addInitScript(mockScript);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://localhost:1430/${hash}`);
  await page.waitForSelector(".foot");
  await page.clock.runFor(10);
  return { page, context, errors };
}

export const fs = (page) => page.evaluate(() => window.__mockFs);
export const writes = (page) => page.evaluate(() => window.__writes);
export const texts = (page, list) =>
  page.$$eval(`[data-list="${list}"] .item .text`, (els) => els.map((e) => e.textContent));

export function launch() {
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
