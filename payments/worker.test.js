// @vitest-environment node
import { generateKeyPairSync, verify as nodeVerify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handle, PRICE } from "./worker.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

function makeEnv() {
  const kv = new Map();
  return {
    TOSS_SECRET_KEY: "test_sk",
    LICENSE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
    ALLOWED_ORIGINS: "https://aruu.dev",
    LICENSES: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) },
  };
}

const confirm = (body) =>
  new Request("https://pay.test/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://aruu.dev" },
    body: JSON.stringify(body),
  });

const tossOk = () =>
  vi.fn(async () => new Response(JSON.stringify({ status: "DONE", totalAmount: PRICE, approvedAt: "2026-10-15T21:00:00+09:00" })));

function verifyLicense(license) {
  const [payload, sig] = license.slice(4).split(".");
  const ok = nodeVerify(null, Buffer.from(payload, "base64url"), publicKey, Buffer.from(sig, "base64url"));
  return { ok, data: JSON.parse(Buffer.from(payload, "base64url").toString()) };
}

describe("결제 서버", () => {
  it("결제가 승인되면 앱이 확인할 수 있는 라이선스 키를 준다", async () => {
    const fetchImpl = tossOk();
    const res = await handle(confirm({ paymentKey: "pk", orderId: "aru-1", amount: PRICE, name: "a@b.c" }), makeEnv(), fetchImpl);
    expect(res.status).toBe(200);
    const { license } = await res.json();
    expect(license.startsWith("ARU-")).toBe(true);
    const { ok, data } = verifyLicense(license);
    expect(ok).toBe(true);
    expect(data).toEqual({ v: 1, n: "a@b.c", o: "aru-1", d: "2026-10-15" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.tosspayments.com/v1/payments/confirm");
    expect(init.headers.Authorization).toBe(`Basic ${btoa("test_sk:")}`);
    expect(JSON.parse(init.body)).toEqual({ paymentKey: "pk", orderId: "aru-1", amount: PRICE });
  });

  it("금액이 다르면 토스에 묻지도 않고 거절한다", async () => {
    const fetchImpl = tossOk();
    const res = await handle(confirm({ paymentKey: "pk", orderId: "aru-1", amount: 100 }), makeEnv(), fetchImpl);
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("토스가 승인하지 않으면 그 이유를 전하고 키를 주지 않는다", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: "REJECT_CARD_COMPANY", message: "카드사 거절" }), { status: 400 }));
    const res = await handle(confirm({ paymentKey: "pk", orderId: "aru-1", amount: PRICE }), makeEnv(), fetchImpl);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "카드사 거절", code: "REJECT_CARD_COMPANY" });
  });

  it("같은 주문을 다시 확인하면 토스에 다시 묻지 않고 처음 키를 준다", async () => {
    const env = makeEnv();
    const fetchImpl = tossOk();
    const first = await (await handle(confirm({ paymentKey: "pk", orderId: "aru-2", amount: PRICE }), env, fetchImpl)).json();
    const again = await (await handle(confirm({ paymentKey: "pk", orderId: "aru-2", amount: PRICE }), env, fetchImpl)).json();
    expect(again.license).toBe(first.license);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("허용한 사이트에서 온 요청에만 응답 헤더를 열어 준다", async () => {
    const res = await handle(new Request("https://pay.test/confirm", { method: "OPTIONS", headers: { Origin: "https://aruu.dev" } }), makeEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://aruu.dev");
  });
});
