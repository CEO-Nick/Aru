// 실제 앱 화면을 사람이 쓰는 것처럼 조작하면서 녹화해 GIF로 만든다.
// 크롬 화면 전송(screencast)으로 프레임을 받고 ffmpeg로 GIF를 만든다.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const mockScript = readFileSync(fileURLToPath(new URL("../mockTauri.js", import.meta.url)), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'><path d='M3 2 L3 18 L7.5 13.8 L10.6 20.5 L13.4 19.2 L10.4 12.6 L16.5 12.6 Z' fill='black' stroke='white' stroke-width='1.4' stroke-linejoin='round'/></svg>`;

export async function openScene(browser, { url, viewport, files = {}, now = "2026-10-14T10:00:00", freezeClock = false }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  if (freezeClock) await page.clock.install({ time: new Date(now) });
  else await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(`window.__initialFiles = ${JSON.stringify(files)};`);
  await page.addInitScript(mockScript);
  await page.goto(url);
  await page.waitForTimeout(400);
  await page.evaluate((svg) => {
    const c = document.createElement("div");
    c.id = "__cursor";
    c.innerHTML = svg;
    Object.assign(c.style, {
      position: "fixed", left: "0", top: "0", width: "22px", height: "22px", zIndex: 99999,
      pointerEvents: "none", transform: "translate(-200px,-200px)", transition: "none",
    });
    document.body.appendChild(c);
    const r = document.createElement("div");
    r.id = "__ripple";
    Object.assign(r.style, {
      position: "fixed", width: "30px", height: "30px", marginLeft: "-15px", marginTop: "-15px",
      borderRadius: "50%", border: "2px solid #ffffffcc", zIndex: 99998, pointerEvents: "none", opacity: "0",
    });
    document.body.appendChild(r);
  }, CURSOR_SVG);
  return new Scene(page, context);
}

class Scene {
  constructor(page, context) {
    this.page = page;
    this.context = context;
    this.x = viewportCenter(page).x;
    this.y = viewportCenter(page).y + 200;
    this.frames = [];
  }

  async start() {
    this.cdp = await this.context.newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", async (f) => {
      this.frames.push({ data: f.data, t: f.metadata.timestamp });
      await this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await this.setCursor(this.x, this.y);
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
    await sleep(500);
  }

  async setCursor(x, y) {
    this.x = x;
    this.y = y;
    await this.page.evaluate(([x, y]) => {
      document.getElementById("__cursor").style.transform = `translate(${x - 3}px, ${y - 2}px)`;
    }, [x, y]);
  }

  /** 마우스를 부드럽게 옮긴다(실제 포인터도 함께 움직여 hover가 걸린다) */
  async moveTo(x, y, ms = 450) {
    const steps = Math.max(6, Math.round(ms / 16));
    const sx = this.x, sy = this.y;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const nx = sx + (x - sx) * e, ny = sy + (y - sy) * e;
      await this.page.mouse.move(nx, ny);
      await this.setCursor(nx, ny);
      await sleep(ms / steps);
    }
  }

  async center(locator) {
    const b = await locator.boundingBox();
    if (!b) throw new Error("화면에 없는 요소");
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
  }

  async ripple() {
    await this.page.evaluate(([x, y]) => {
      const r = document.getElementById("__ripple");
      r.style.left = x + "px";
      r.style.top = y + "px";
      r.animate([{ opacity: 1, transform: "scale(.4)" }, { opacity: 0, transform: "scale(1.3)" }], { duration: 420, easing: "ease-out" });
    }, [this.x, this.y]);
  }

  async click(locator, { ms = 450, offsetX = 0, at } = {}) {
    const c = at ?? (await this.center(locator));
    await this.moveTo(c.x + offsetX, c.y, ms);
    await sleep(120);
    await this.page.mouse.down();
    await this.ripple();
    await this.page.mouse.up();
    await sleep(220);
  }

  async type(text, delay = 70) {
    for (const ch of text) {
      await this.page.keyboard.insertText(ch);
      await sleep(delay);
    }
  }

  async press(key, pause = 260) {
    await this.page.keyboard.press(key);
    await sleep(pause);
  }

  /** 손잡이를 잡고 목적지까지 끈다 */
  async drag(fromLocator, to, { hold = 250, ms = 900, hover } = {}) {
    await this.moveTo(...Object.values(await this.center(fromLocator)).slice(0, 2), 450);
    if (hover) await hover();
    await sleep(hold);
    await this.page.mouse.down();
    await this.ripple();
    await this.moveTo(to.x, to.y, ms);
    await sleep(250);
    await this.page.mouse.up();
    await sleep(300);
  }

  wait(ms) {
    return sleep(ms);
  }

  /** 녹화를 멈추고 GIF로 저장한다. width: 결과 GIF 가로 픽셀 */
  async save(outPath, { width, fps = 18, tail = 1600, colors = 200 } = {}) {
    await sleep(300);
    await this.cdp.send("Page.stopScreencast");
    await this.context.close();
    const dir = `${outPath}.frames`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const lines = [];
    this.frames.forEach((f, i) => {
      const name = `f${String(i).padStart(5, "0")}.jpg`;
      writeFileSync(join(dir, name), Buffer.from(f.data, "base64"));
      const next = this.frames[i + 1];
      const dur = next ? Math.max(0.01, next.t - f.t) : tail / 1000;
      lines.push(`file '${name}'`, `duration ${dur.toFixed(3)}`);
    });
    lines.push(`file 'f${String(this.frames.length - 1).padStart(5, "0")}.jpg'`);
    writeFileSync(join(dir, "list.txt"), lines.join("\n"));
    const filter =
      `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];` +
      `[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", filter, "-loop", "0", outPath]);
    rmSync(dir, { recursive: true, force: true });
    return { frames: this.frames.length };
  }
}

function viewportCenter(page) {
  const v = page.viewportSize();
  return { x: v.width / 2, y: v.height / 2 };
}
