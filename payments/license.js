// 라이선스 키를 만든다. 결제 서버(Cloudflare Worker)와 수동 발급 명령이 같이 쓴다.
// 키 형식: ARU-<내용(base64url)>.<Ed25519 서명(base64url)>. 앱은 공개 키로 서명만 확인한다.

const toB64Url = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export async function importPrivateKey(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
}

/** name: 받는 사람(이메일·이름), order: 주문 번호(수동 발급이면 "manual-..."), date: 발급일 YYYY-MM-DD */
export async function issueLicense(privateKey, { name, order, date }) {
  const payload = new TextEncoder().encode(JSON.stringify({ v: 1, n: name, o: order, d: date }));
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, payload));
  return `ARU-${toB64Url(payload)}.${toB64Url(sig)}`;
}
