// App Store Connect API를 부르는 작은 도구. 서명 인증서·앱 ID·프로비저닝 프로파일을 만들 때 쓴다.
// 키 정보는 저장소 밖 env 파일에서 읽는다(ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH).
// 사용:
//   node scripts/asc.mjs get <경로>                       예: get /v1/certificates
//   node scripts/asc.mjs patch <경로> <JSON 본문>          예: 스토어 문구 고치기
//   node scripts/asc.mjs cert <MAC_APP_DISTRIBUTION|MAC_INSTALLER_DISTRIBUTION> <csr 파일> <저장할 .cer>
//   node scripts/asc.mjs bundle <identifier> <이름>
//   node scripts/asc.mjs profile <이름> <bundleId 리소스 id> <인증서 리소스 id> <저장할 .provisionprofile>
import { createSign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const envFile = process.env.ASC_ENV ?? `${homedir()}/.aru-signing/asc.env`;
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const b64url = (b) => Buffer.from(b).toString("base64url");
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: env.ASC_KEY_ID, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }));
  const sig = createSign("SHA256").update(`${head}.${body}`).sign({ key: readFileSync(env.ASC_KEY_PATH), dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(sig)}`;
}

async function call(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const json = res.status === 204 ? {} : await res.json();
  if (!res.ok) {
    console.error(JSON.stringify(json.errors ?? json, null, 2));
    process.exit(1);
  }
  return json;
}

const [cmd, ...a] = process.argv.slice(2);
if (cmd === "get") {
  console.log(JSON.stringify(await call("GET", a[0]), null, 2));
} else if (cmd === "patch") {
  console.log(JSON.stringify(await call("PATCH", a[0], JSON.parse(a[1])), null, 2));
} else if (cmd === "cert") {
  const csr = readFileSync(a[1], "utf8").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const r = await call("POST", "/v1/certificates", { data: { type: "certificates", attributes: { certificateType: a[0], csrContent: csr } } });
  writeFileSync(a[2], Buffer.from(r.data.attributes.certificateContent, "base64"));
  console.log(JSON.stringify({ id: r.data.id, name: r.data.attributes.name, expires: r.data.attributes.expirationDate }));
} else if (cmd === "bundle") {
  const r = await call("POST", "/v1/bundleIds", { data: { type: "bundleIds", attributes: { identifier: a[0], name: a[1], platform: "MAC_OS" } } });
  console.log(JSON.stringify({ id: r.data.id, identifier: r.data.attributes.identifier }));
} else if (cmd === "profile") {
  const r = await call("POST", "/v1/profiles", {
    data: {
      type: "profiles",
      attributes: { name: a[0], profileType: "MAC_APP_STORE" },
      relationships: {
        bundleId: { data: { type: "bundleIds", id: a[1] } },
        certificates: { data: [{ type: "certificates", id: a[2] }] },
      },
    },
  });
  writeFileSync(a[3], Buffer.from(r.data.attributes.profileContent, "base64"));
  console.log(JSON.stringify({ id: r.data.id, name: r.data.attributes.name, expires: r.data.attributes.expirationDate }));
} else {
  console.error("사용법은 파일 머리말을 보세요");
  process.exit(1);
}
