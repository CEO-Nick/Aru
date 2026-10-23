// docs/APP_STORE_LISTING.md의 "### 칸 이름 (한도)" 아래 코드 블록 글자 수를 재고, 한도를 넘으면 실패한다
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../docs/APP_STORE_LISTING.md", import.meta.url), "utf8");
const re = /^### (.+?) \((\d+)[^)]*\)\n+```\n([\s\S]*?)\n```/gm;
let failed = false;
for (const [, name, limit, body] of text.matchAll(re)) {
  const n = [...body].length;
  const ok = n <= Number(limit);
  if (!ok) failed = true;
  console.log(`${ok ? "OK  " : "넘침"} ${String(n).padStart(4)} / ${limit.padEnd(4)} ${name}`);
}
process.exit(failed ? 1 : 0);
