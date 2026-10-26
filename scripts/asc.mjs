// App Store Connect API를 부르는 작은 도구. 서명 인증서·앱 ID·프로비저닝 프로파일을 만들 때 쓴다.
// 키 정보는 저장소 밖 env 파일에서 읽는다(ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH).
// 사용:
//   node scripts/asc.mjs get <경로>                       예: get /v1/certificates
//   node scripts/asc.mjs patch <경로> <JSON 본문>          예: 스토어 문구 고치기
//   node scripts/asc.mjs post <경로> <JSON 본문>           예: TestFlight 그룹·테스터 만들기
//   node scripts/asc.mjs delete <경로>                     예: 보낸 팀 초대 취소
//   node scripts/asc.mjs screenshots <스크린샷 세트 id> <png…>  세트의 기존 이미지를 지우고 이 순서로 올린다
//   node scripts/asc.mjs cert <MAC_APP_DISTRIBUTION|MAC_INSTALLER_DISTRIBUTION> <csr 파일> <저장할 .cer>
//   node scripts/asc.mjs bundle <identifier> <이름>
//   node scripts/asc.mjs profile <이름> <bundleId 리소스 id> <인증서 리소스 id> <저장할 .provisionprofile>
import { createHash, createSign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
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
} else if (cmd === "screenshots") {
  const [setId, ...files] = a;
  const old = await call("GET", `/v1/appScreenshotSets/${setId}/appScreenshots`);
  for (const shot of old.data) await call("DELETE", `/v1/appScreenshots/${shot.id}`);
  const ids = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    const r = await call("POST", "/v1/appScreenshots", {
      data: {
        type: "appScreenshots",
        attributes: { fileName: basename(file), fileSize: bytes.length },
        relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } },
      },
    });
    for (const op of r.data.attributes.uploadOperations) {
      const res = await fetch(op.url, {
        method: op.method,
        headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])),
        body: bytes.subarray(op.offset, op.offset + op.length),
      });
      if (!res.ok) throw new Error(`올리기 실패 ${basename(file)}: ${res.status}`);
    }
    const md5 = createHash("md5").update(bytes).digest("hex");
    await call("PATCH", `/v1/appScreenshots/${r.data.id}`, {
      data: { type: "appScreenshots", id: r.data.id, attributes: { uploaded: true, sourceFileChecksum: md5 } },
    });
    ids.push(r.data.id);
    console.log(`올림 ${basename(file)}`);
  }
  await call("PATCH", `/v1/appScreenshotSets/${setId}/relationships/appScreenshots`, {
    data: ids.map((id) => ({ type: "appScreenshots", id })),
  });
  console.log("순서 맞춤");
} else if (cmd === "delete") {
  await call("DELETE", a[0]);
  console.log("삭제함");
} else if (cmd === "post") {
  console.log(JSON.stringify(await call("POST", a[0], JSON.parse(a[1])), null, 2));
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
