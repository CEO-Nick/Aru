// 사용: node site/shot.mjs <출력 폴더> [주소]  — 랜딩페이지를 데스크톱·모바일로 캡처하고 데모 창 동작을 확인한다
import { chromium } from "playwright-core";

const out = process.argv[2] ?? ".";
const url = process.argv[3] ?? "http://127.0.0.1:8765/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];

const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
desk.on("pageerror", (e) => errors.push(e.message));
desk.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await desk.goto(url, { waitUntil: "networkidle" });
await desk.waitForTimeout(1200);
await desk.screenshot({ path: `${out}/site-hero.png` });

await desk.evaluate(() => document.querySelectorAll(".reveal").forEach((e) => e.classList.add("in")));
for (const name of ["midnight-keep", "quick"]) {
  await desk.evaluate((n) => document.querySelector(`img[src^="media/${n}.gif"]`).closest("article").scrollIntoView({ block: "center" }), name);
  await desk.waitForTimeout(900);
  await desk.screenshot({ path: `${out}/site-${name}.png` });
}

const app = desk.frameLocator(".float iframe");
const before = await app.locator('[data-list="today"] .item').count();
await app.locator('[data-list="today"] .add input').fill("데모에서 추가");
await app.locator('[data-list="today"] .add input').press("Enter");
console.log(`데모 창 할 일 ${before} → ${await app.locator('[data-list="today"] .item').count()}`);

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(url, { waitUntil: "networkidle" });
console.log("모바일 가로 넘침 px:", await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth));

console.log(errors.length ? errors.join("\n") : "콘솔 오류 없음");
await browser.close();
