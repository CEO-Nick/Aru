// 결제 없이 라이선스 키를 직접 만든다(친구·테스터·이벤트용, 또는 계좌이체로 판 경우).
// 사용: node payments/issue.mjs "받는 사람"
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { importPrivateKey, issueLicense } from "./license.js";

const name = process.argv.slice(2).join(" ").trim();
if (!name) {
  console.error('받는 사람을 적어 주세요. 예: node payments/issue.mjs "김민수"');
  process.exit(1);
}
const key = await importPrivateKey(readFileSync(`${homedir()}/.aru/license-private.pem`, "utf8"));
const today = new Date().toISOString().slice(0, 10);
console.log(await issueLicense(key, { name, order: `manual-${Date.now()}`, date: today }));
