// 사용: node e2e/record/scenes.mjs <출력 폴더> [장면 이름…]
import { mkdirSync } from "node:fs";
import { launch, startServer } from "../harness.mjs";
import { openScene } from "./recorder.mjs";

const out = process.argv[2] ?? "site/media";
const only = process.argv.slice(3);
mkdirSync(out, { recursive: true });

const STAGE = { url: "http://localhost:1430/e2e/record/stage.html", viewport: { width: 372, height: 530 } };
const TODAY = "daily/2026-10-14.md";

const scenes = {
  // 쓰고, 체크하고, 고치고, 지우기
  async write(browser) {
    const s = await openScene(browser, {
      ...STAGE,
      files: { [TODAY]: "- [ ] 디자인 리뷰 준비\n", "someday.md": "- [ ] 여권 갱신\n" },
    });
    const app = s.page.frameLocator("#app");
    await s.start();
    await s.click(app.locator('[data-list="today"] .add input'));
    await s.type("주간 회의록 정리");
    await s.press("Enter");
    await s.type("팀 점심 장소 예약");
    await s.press("Enter", 500);
    await s.click(app.locator('[data-list="today"] .item .box').first());
    await s.wait(500);
    const second = app.locator('[data-list="today"] .item .text').nth(1);
    await s.click(second, { offsetX: 60 });
    await s.press("End", 150);
    await s.press("Enter", 300);
    await s.type("PR 리뷰 반영");
    await s.wait(500);
    await s.press("ArrowUp", 350);
    await s.press("ArrowUp", 350);
    await s.press("ArrowDown", 600);
    return s;
  },

  // 커서 자리에서 Enter로 나누고, 맨 앞 Backspace로 합치기
  async split(browser) {
    const s = await openScene(browser, {
      ...STAGE,
      files: { [TODAY]: "- [ ] 전자고지서 스테이지 배포하기\n- [ ] 회의록 정리\n" },
    });
    const app = s.page.frameLocator("#app");
    await s.start();
    const text = app.locator('[data-list="today"] .item .text').first();
    const box = await text.boundingBox();
    // "스테이지" 바로 뒤를 눌러 커서를 둔다
    await s.click(text, { at: { x: box.x + 10, y: box.y + box.height / 2 } });
    await s.page.evaluate(() => {
      const el = document.getElementById("app").contentDocument.querySelector('[data-list="today"] .item .text');
      const r = el.ownerDocument.createRange();
      r.setStart(el.firstChild, "전자고지서 스테이지".length);
      r.collapse(true);
      const sel = el.ownerDocument.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await s.wait(700);
    await s.press("Enter", 900);
    await s.type("오늘 ");
    await s.wait(900);
    await s.press("ArrowLeft", 120);
    await s.press("ArrowLeft", 120);
    await s.press("ArrowLeft", 500);
    await s.press("Backspace", 1200);
    return s;
  },

  // 체크하면 1초 뒤 끝낸 일들 위로
  async sort(browser) {
    const s = await openScene(browser, {
      ...STAGE,
      files: {
        [TODAY]: "- [ ] 스크럼\n- [ ] 회의록 정리\n- [ ] PR 리뷰 반영\n- [ ] 배포 체크리스트\n- [x] 메일 확인\n",
      },
    });
    const app = s.page.frameLocator("#app");
    await s.start();
    const box = (name) => app.locator('[data-list="today"] .item', { hasText: name }).locator(".box");
    await s.click(box("스크럼"));
    await s.wait(1500);
    await s.click(box("PR 리뷰 반영"));
    await s.wait(1500);
    await s.click(box("배포 체크리스트"));
    await s.wait(450);
    await s.click(box("배포 체크리스트"));
    await s.wait(1500);
    return s;
  },

  // 손잡이로 순서 바꾸기, 언젠가로 내리기
  async drag(browser) {
    const s = await openScene(browser, {
      ...STAGE,
      files: {
        [TODAY]: "- [ ] 회의록 정리\n- [ ] PR 리뷰 반영\n- [ ] 배포 체크리스트\n- [ ] 블로그 초안\n",
        "someday.md": "- [ ] 여권 갱신\n- [ ] 책상 정리\n",
      },
    });
    const app = s.page.frameLocator("#app");
    await s.start();
    const grip = (n) => app.locator(`[data-list="today"] .item >> nth=${n}`).locator(".grip");
    const first = await s.center(app.locator('[data-list="today"] .item').first());
    await s.drag(grip(2), { x: first.x + 20, y: first.box.y + 3 });
    await s.wait(500);
    const someday = await s.center(app.locator('[data-list="someday"] .add'));
    await s.drag(grip(3), { x: someday.x, y: someday.box.y + 3 }, { ms: 1100 });
    await s.wait(700);
    return s;
  },

  // 날짜 넘기기, 미래에 적어 두기
  async dates(browser) {
    const s = await openScene(browser, {
      ...STAGE,
      files: {
        "daily/2026-10-13.md": "- [x] 정기 배포 확인\n- [x] 스크럼\n",
        [TODAY]: "- [ ] 회의록 정리\n",
      },
    });
    const app = s.page.frameLocator("#app");
    await s.start();
    await s.click(app.locator('[aria-label="이전 날"]'));
    await s.wait(700);
    await s.click(app.locator('[aria-label="다음 날"]'));
    await s.wait(250);
    await s.click(app.locator('[aria-label="다음 날"]'));
    await s.wait(250);
    await s.click(app.locator('[aria-label="다음 날"]'));
    await s.wait(400);
    await s.click(app.locator('[data-list="today"] .add input'));
    await s.type("치과 예약 3시");
    await s.press("Enter", 600);
    await s.click(app.locator(".today-btn"));
    await s.wait(800);
    return s;
  },

  // 자정 넘김 설정 세 가지: 같은 할 일로 결과를 비교한다
  async "midnight-keep"(browser) {
    return midnightScene(browser, "keep");
  },
  async "midnight-next"(browser) {
    return midnightScene(browser, "next-day");
  },
  async "midnight-someday"(browser) {
    return midnightScene(browser, "someday");
  },

  // 다른 앱 창을 눌러도 맨 앞, 고정을 풀면 뒤로, 흐리게 하면 비쳐 보인다
  async window(browser) {
    const s = await openScene(browser, {
      url: "http://localhost:1430/e2e/record/pinstage.html",
      viewport: { width: 940, height: 500 },
      files: { [TODAY]: "- [ ] 스테이지 배포\n- [ ] PR 리뷰 반영\n- [ ] 회의록 정리\n", "someday.md": "- [ ] 여권 갱신\n" },
    });
    const app = s.page.frameLocator("#app");
    const barAt = async (id) => {
      const b = await s.page.locator(`#${id} .bar`).boundingBox();
      return { x: b.x + (id === "browser" ? 190 : 120), y: b.y + b.height / 2 };
    };
    await s.start();
    await s.wait(600);
    // 고정 켬: 브라우저와 편집기를 번갈아 눌러도 Aru는 그 위에 남는다
    await s.click(null, { at: await barAt("browser") });
    await s.wait(900);
    await s.click(null, { at: await barAt("editor") });
    await s.wait(700);
    await s.click(null, { at: await barAt("browser") });
    await s.wait(900);
    // 고정 끔: 브라우저를 누르면 Aru가 뒤로 간다
    await s.click(app.locator('[aria-label="항상 위에 고정"]'));
    await s.wait(800);
    await s.click(null, { at: await barAt("browser") });
    await s.wait(1100);
    // 다시 Aru를 눌러 앞으로 가져오고 고정을 켠다
    await s.click(null, { at: { x: 860, y: 300 } });
    await s.wait(400);
    await s.click(app.locator('[aria-label="항상 위에 고정"]'));
    await s.wait(800);
    // 흐리게: 뒤의 브라우저가 비쳐 보인다
    const slider = await s.center(app.locator('input[type="range"]'));
    const right = slider.box.x + slider.box.width - 4;
    const left = slider.box.x + 4;
    await s.moveTo(right, slider.y);
    await s.page.mouse.down();
    await s.ripple();
    await s.moveTo(left + 10, slider.y, 1100);
    await s.wait(700);
    await s.moveTo(left + slider.box.width * 0.65, slider.y, 900);
    await s.page.mouse.up();
    await s.wait(900);
    return s;
  },

  // Cmd+S와 저장 표시
  async save(browser) {
    const s = await openScene(browser, {
      ...STAGE,
      files: { [TODAY]: "- [ ] 회의록 정리\n" },
    });
    const app = s.page.frameLocator("#app");
    await s.start();
    await s.click(app.locator('[data-list="today"] .item .text'), { offsetX: 40 });
    await s.press("End", 150);
    await s.type(" (공유 링크 첨부)");
    await s.wait(300);
    await s.press("Meta+s", 1800);
    return s;
  },

  // Claude Code에 "할 일에 넣어줘" → Aru에 AI 태그로 들어오고, 태그를 눌러 확인한다
  async ai(browser) {
    const s = await openScene(browser, {
      url: "http://localhost:1430/e2e/record/aistage.html",
      viewport: { width: 940, height: 500 },
      files: { [TODAY]: "- [x] 스크럼\n- [ ] PR 리뷰 반영\n", "someday.md": "- [ ] 여권 갱신\n" },
    });
    const app = s.page.frameLocator("#app");
    await s.start();
    await s.wait(600);
    await s.page.evaluate(() =>
      window.playAi({
        prompt: "회의에서 나온 거 오늘 할 일에 넣어줘. 회의록 정리, 스테이지 배포",
        items: ["회의록 정리", "스테이지 배포"],
        path: "daily/2026-10-14.md",
      }),
    );
    await s.wait(1600);
    const tag = app.locator('[data-list="today"] .item', { hasText: "회의록 정리" }).locator(".ai");
    await s.moveTo(...Object.values(await s.center(tag)).slice(0, 2), 700);
    await s.wait(900);
    await s.click(tag, { ms: 200 });
    await s.wait(1200);
    return s;
  },

  // 어떤 앱에서든 ⌥Space로 바로 추가
  async quick(browser) {
    const s = await openScene(browser, {
      url: "http://localhost:1430/e2e/record/quickstage.html",
      viewport: { width: 940, height: 500 },
      files: { [TODAY]: "- [x] 스크럼\n- [ ] 회의록 정리\n", "someday.md": "- [ ] 여권 갱신\n" },
    });
    const q = s.page.frameLocator("#quick");
    await s.start();
    await s.moveTo(260, 300, 500);
    await s.wait(500);
    await s.page.evaluate(() => window.pressShortcut());
    await s.wait(700);
    await q.locator("input").focus();
    await s.type("스테이지 배포 결과 공유", 80);
    await s.wait(300);
    await s.press("Enter", 1400);
    await s.wait(500);
    await s.page.evaluate(() => window.pressShortcut());
    await s.wait(700);
    await q.locator("input").focus();
    await s.press("Tab", 400);
    await s.type("노트북 배터리 교체", 80);
    await s.press("Enter", 1600);
    return s;
  },

  // 모아보기 달력
  async overview(browser) {
    const s = await openScene(browser, {
      url: "http://localhost:1430/#overview",
      viewport: { width: 1180, height: 760 },
      files: {
        "daily/2026-10-12.md": "- [x] 주간 회의\n- [x] PR 리뷰\n- [x] 메일 정리\n- [ ] 위키 정리\n",
        "daily/2026-10-13.md": "- [x] 정기 배포 확인\n- [ ] 문서 현행화\n",
        [TODAY]: "- [x] 스크럼\n- [ ] 회의록 정리\n- [ ] PR 리뷰 반영\n",
        "daily/2026-10-16.md": "- [ ] 치과 예약\n",
        "daily/2026-10-20.md": "- [ ] 분기 보고서 제출\n",
        "someday.md": "- [ ] 여권 갱신\n- [ ] 책상 정리\n- [ ] 자전거 타이어 교체\n",
      },
    });
    const p = s.page;
    await s.start();
    await s.click(p.locator('.cell[data-date="2026-10-16"]'));
    await s.wait(500);
    await s.click(p.locator('[data-list="overview"] .add input'));
    await s.type("장보기");
    await s.press("Enter", 600);
    const cell = await s.center(p.locator('.cell[data-date="2026-10-22"]'));
    await s.drag(p.locator('[data-list="someday"] .item >> nth=0').locator(".grip"), cell, { ms: 1300 });
    await s.wait(500);
    await s.click(p.locator('.cell[data-date="2026-10-22"]'));
    await s.wait(1000);
    return s;
  },
};


async function midnightScene(browser, carryOver) {
  const s = await openScene(browser, {
    ...STAGE,
    now: "2026-10-14T23:59:53",
    freezeClock: true,
    files: {
      "settings.json": JSON.stringify({ carryOver, lastRolloverDate: "2026-10-14" }),
      [TODAY]: "- [x] 스크럼\n- [ ] PR 리뷰 반영\n- [x] 회의록 정리\n- [ ] 배포 체크리스트\n",
      "someday.md": "- [ ] 여권 갱신\n",
    },
  });
  await s.page.clock.runFor(100);
  await s.start();
  await s.wait(900);
  for (let i = 0; i < 8; i++) {
    await s.page.clock.runFor(1000);
    await s.wait(170);
  }
  await s.page.clock.runFor(500);
  await s.wait(1800);
  return s;
}

const widths = { overview: 960, quick: 900, window: 900, ai: 900 };
const fpsOf = { window: 12 };
// 색 수를 줄이면 파란 핀·창 버튼 색이 회색으로 뭉개진다. 용량보다 실제 모습이 우선이다
const colorsOf = {};
const server = await startServer();
const browser = await launch();
try {
  for (const [name, scene] of Object.entries(scenes)) {
    if (only.length && !only.includes(name)) continue;
    const s = await scene(browser);
    const { frames } = await s.save(`${out}/${name}.gif`, { width: widths[name] ?? 560, fps: fpsOf[name] ?? 18, colors: colorsOf[name] });
    console.log(`${name}.gif  (${frames} frames)`);
  }
} finally {
  await browser.close();
  await server.close();
}
