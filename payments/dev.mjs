// 결제 서버를 내 맥에서 돌린다(Cloudflare에 올리기 전 확인용). 토스는 테스트 키만 쓴다.
// 사용: node payments/dev.mjs  (기본 포트 8787)
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { handle } from "./worker.js";

const kv = new Map();
const env = {
  // 토스페이먼츠 문서에 공개된 테스트 시크릿 키(실제 돈이 오가지 않는다)
  TOSS_SECRET_KEY: process.env.TOSS_SECRET_KEY ?? "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6",
  LICENSE_PRIVATE_KEY: readFileSync(`${homedir()}/.aru/license-private.pem`, "utf8"),
  ALLOWED_ORIGINS: "http://127.0.0.1:8765,http://localhost:8765",
  LICENSES: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) },
};

const port = Number(process.env.PORT ?? 8787);
createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await handle(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`결제 서버(테스트) http://localhost:${port}`));
