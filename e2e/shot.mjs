// 사용: node e2e/shot.mjs <출력 폴더>  — 견본 데이터로 두 창을 캡처한다
import { launch, openApp, startServer } from "./harness.mjs";

const out = process.argv[2] ?? ".";
const files = {
  "daily/2026-10-12.md": "- [x] 주간 회의\n- [x] PR 리뷰\n- [x] 메일 정리\n- [ ] 위키 정리\n- [x] 정산 확인\n",
  "daily/2026-10-13.md": "- [x] 정기배포 확인\n- [ ] 도메인 문서 현행화\n",
  "daily/2026-10-14.md":
    "- [x] 데일리 스크럼\n- [ ] 전출 알림 배치 테스트 문서\n- [ ] PR 리뷰 반영 <!-- from:2026-10-12 -->\n- [ ] 주간리뷰 회의록 정리\n",
  "daily/2026-10-16.md": "- [ ] 치과 예약\n- [ ] 장보기\n",
  "daily/2026-10-20.md": "- [ ] 분기 보고서 제출\n",
  "someday.md": "- [ ] 여권 갱신\n- [ ] 책상 정리\n- [x] 자전거 타이어 교체\n",
};

const server = await startServer();
const browser = await launch();
const small = await openApp(browser, { files });
await small.page.screenshot({ path: `${out}/small.png` });
const big = await openApp(browser, { files, hash: "#overview", viewport: { width: 1180, height: 760 } });
await big.page.locator('.cell[data-date="2026-10-16"]').click();
await big.page.clock.runFor(10);
await big.page.screenshot({ path: `${out}/overview.png` });
await browser.close();
await server.close();
