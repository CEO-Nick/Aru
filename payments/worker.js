// Aru 결제 서버(Cloudflare Worker). 결제 페이지가 토스 결제를 마치면 여기로 승인을 요청하고,
// 승인되면 라이선스 키를 만들어 돌려준다. 할 일 데이터는 여기로 오지 않는다.
//
// 환경 변수(비밀값): TOSS_SECRET_KEY, LICENSE_PRIVATE_KEY(PKCS8 PEM)
// 설정: ALLOWED_ORIGINS(쉼표로 구분), 저장소: LICENSES(KV, 주문번호 → 발급한 키)
import { importPrivateKey, issueLicense } from "./license.js";

export const PRICE = 3900;
const TOSS_CONFIRM = "https://api.tosspayments.com/v1/payments/confirm";

function cors(request, env) {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] ?? "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export async function handle(request, env, fetchImpl = fetch) {
  const headers = cors(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/confirm") return json({ message: "없는 주소예요" }, 404, headers);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: "요청 형식이 틀렸어요" }, 400, headers);
  }
  const { paymentKey, orderId, amount, name } = body ?? {};
  if (!paymentKey || !orderId || Number(amount) !== PRICE) {
    return json({ message: "결제 정보가 맞지 않아요" }, 400, headers);
  }

  // 같은 주문을 새로고침 등으로 다시 확인하면 처음 발급한 키를 그대로 준다
  const stored = await env.LICENSES?.get(orderId);
  if (stored) return json({ license: stored }, 200, headers);

  const res = await fetchImpl(TOSS_CONFIRM, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.TOSS_SECRET_KEY}:`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ paymentKey, orderId, amount: PRICE }),
  });
  const payment = await res.json();
  if (!res.ok) return json({ message: payment.message ?? "결제를 승인하지 못했어요", code: payment.code }, 400, headers);
  if (payment.status !== "DONE" || payment.totalAmount !== PRICE) {
    return json({ message: "결제가 끝나지 않았어요" }, 400, headers);
  }

  const key = await importPrivateKey(env.LICENSE_PRIVATE_KEY);
  const holder = String(name ?? "").trim().slice(0, 80) || "Aru 사용자";
  const license = await issueLicense(key, {
    name: holder,
    order: orderId,
    date: String(payment.approvedAt ?? new Date().toISOString()).slice(0, 10),
  });
  await env.LICENSES?.put(orderId, license);
  return json({ license }, 200, headers);
}

export default {
  fetch: (request, env) => handle(request, env),
};
