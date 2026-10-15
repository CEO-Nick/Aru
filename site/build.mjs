// 랜딩페이지에 띄울 "진짜 Aru 창"을 만든다.
// 앱 화면을 그대로 빌드하고, Tauri 대신 브라우저 안 가짜 저장소(e2e/mockTauri.js)를 끼운다.
// 사용: node site/build.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const demo = `${root}/site/demo`;

execFileSync("npx", ["vite", "build", "--base", "./", "--outDir", demo, "--emptyOutDir"], {
  cwd: root,
  stdio: "inherit",
});

copyFileSync(`${root}/e2e/mockTauri.js`, `${demo}/mock.js`);

// 방문자가 처음 보는 할 일. 날짜는 방문한 날 기준으로 만든다
const seed = `
(() => {
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  window.__initialFiles = {
    ["daily/" + iso(today) + ".md"]:
      "- [x] 메일 확인\\n- [ ] 디자인 리뷰 준비\\n- [ ] 회의록 정리 <!-- from:" + iso(yesterday) + " -->\\n- [ ] 저녁 장보기\\n",
    "someday.md": "- [ ] 여권 갱신\\n- [ ] 책상 정리\\n- [ ] 자전거 타이어 교체\\n",
    "settings.json": JSON.stringify({ lastRolloverDate: iso(today) }),
  };
})();
`;
writeFileSync(`${demo}/seed.js`, seed);

const html = readFileSync(`${demo}/index.html`, "utf8").replace(
  "<head>",
  `<head>\n    <script src="./seed.js"></script>\n    <script src="./mock.js"></script>`,
);
writeFileSync(`${demo}/index.html`, html);
console.log("site/demo 준비 완료");

// Cloudflare가 예전 GIF·다운로드 파일을 캐시해 두므로, 배포할 때마다 주소에 버전 표시를 새로 붙인다
const version = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
const page = `${root}/site/index.html`;
writeFileSync(
  page,
  readFileSync(page, "utf8").replace(
    /((?:media\/[a-z-]+\.gif)|(?:demo\/index\.html))(\?v=\w+)?/g,
    `$1?v=${version}`,
  ),
);
console.log(`버전 표시: ${version}`);
