// 앱스토어 맥 스크린샷(2880×1800)을 실제 앱 화면으로 찍는다.
// 사용: node e2e/record/store-shots.mjs [출력 폴더] [장면 이름…]
import { mkdirSync } from "node:fs";
import { launch, startServer } from "../harness.mjs";
import { openScene } from "./recorder.mjs";

const out = process.argv[2] ?? "docs/app-store/screenshots/ko";
const only = process.argv.slice(3);
mkdirSync(out, { recursive: true });

const TODAY = "daily/2026-10-14.md";
const baseSettings = { carryOver: "next-day", lastRolloverDate: "2026-10-14", alwaysOnTop: true, opacity: 100 };
const someday = "- [ ] 여권 갱신\n- [ ] 책상 정리\n- [ ] 자전거 타이어 교체\n";
const at = new Date("2026-10-14T09:58:00").getTime();

const shots = [
  {
    name: "01-floating",
    scene: "floating",
    settings: { opacity: 60 },
    files: {
      [TODAY]: "- [ ] PR 리뷰 반영 <!-- from:2026-10-13 -->\n- [ ] 배포 체크리스트 <!-- from:2026-10-13 -->\n- [ ] 디자인 리뷰 준비\n- [x] 메일 확인\n",
      "daily/2026-10-13.md": "- [x] 스크럼\n- [x] 회의록 정리\n",
      "someday.md": someday,
    },
  },
  {
    name: "02-ai",
    scene: "ai",
    files: {
      [TODAY]: `- [x] 스크럼\n- [ ] PR 리뷰 반영\n- [ ] 회의 자료 출력 <!-- ai:claude-code@${at} -->\n- [ ] 지난 회의록 다시 읽기 <!-- ai:claude-code@${at} -->\n- [ ] 질문 목록 정리 <!-- ai:claude-code@${at} -->\n`,
      "someday.md": someday,
    },
  },
  {
    name: "03-files",
    scene: "files",
    files: {
      [TODAY]: "- [x] 메일 확인\n- [ ] 디자인 리뷰 준비\n- [ ] 회의록 정리 <!-- from:2026-10-13 -->\n- [ ] 저녁 장보기\n",
      "someday.md": someday,
    },
  },
  {
    name: "04-calendar",
    scene: "overview",
    files: {
      "daily/2026-10-05.md": "- [x] 분기 계획 공유\n",
      "daily/2026-10-08.md": "- [x] 디자인 시안 확인\n- [x] 견적서 보내기\n",
      "daily/2026-10-12.md": "- [x] 주간 회의\n- [x] PR 리뷰\n- [x] 메일 정리\n- [ ] 위키 정리\n",
      "daily/2026-10-13.md": "- [x] 정기 배포 확인\n- [ ] 문서 현행화\n",
      [TODAY]: "- [x] 스크럼\n- [ ] 회의록 정리\n- [ ] PR 리뷰 반영\n",
      "daily/2026-10-16.md": "- [ ] 치과 예약\n",
      "daily/2026-10-20.md": "- [ ] 분기 보고서 제출\n",
      "daily/2026-10-23.md": "- [ ] 엄마 생신 선물\n",
      "daily/2026-10-28.md": "- [ ] 워크숍 발표\n",
      "someday.md": someday,
    },
  },
  {
    name: "05-quick",
    scene: "quick",
    files: { [TODAY]: "- [x] 메일 확인\n- [ ] 디자인 리뷰 준비\n- [ ] 회의록 정리\n", "someday.md": someday },
    prepare: async (page) => {
      const input = page.frameLocator("#quick").locator("input");
      await input.fill("노트북 배터리 교체");
    },
  },
];

const server = await startServer();
const browser = await launch();
try {
  for (const shot of shots) {
    if (only.length && !only.includes(shot.name)) continue;
    const s = await openScene(browser, {
      url: `http://localhost:1430/e2e/record/storestage.html?scene=${shot.scene}`,
      viewport: { width: 1440, height: 900 },
      files: { "settings.json": JSON.stringify({ ...baseSettings, ...shot.settings }), ...shot.files },
    });
    await s.page.waitForTimeout(1200);
    await shot.prepare?.(s.page);
    await s.page.waitForTimeout(400);
    await s.page.screenshot({ path: `${out}/${shot.name}.png` });
    await s.context.close();
    console.log(`${shot.name}.png`);
  }
} finally {
  await browser.close();
  await server.close();
}
