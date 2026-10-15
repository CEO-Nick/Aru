# 결제와 라이선스

판매는 아직 시작하지 않았다. 앱의 `LICENSING_ENABLED`(src-tauri/src/license.rs)가 꺼져 있어 체험·잠금·라이선스 화면이 보이지 않는다.

## 구조

1. 앱 "구매하기" → `https://aruu.dev/aru/buy/` (site/buy)
2. 토스페이먼츠 결제위젯으로 결제 → `success.html`
3. `success.html`이 결제 서버(`worker.js`, Cloudflare Worker) `/confirm`에 승인을 요청
4. 결제 서버가 토스 승인 API로 확인하고 라이선스 키를 서명해 돌려준다(같은 주문은 같은 키)
5. 사용자가 키를 앱 설정에 붙여 넣는다. 앱은 공개 키로 서명만 확인한다(오프라인 가능)

라이선스 서명 비밀 키는 개발자 맥 `~/.aru/license-private.pem`과 결제 서버 비밀값에만 둔다. 저장소에 넣지 않는다. 잃어버리면 새 키 쌍을 만들고 앱의 `PUBLIC_KEY`를 바꿔 배포해야 하며, 그때까지 발급한 키는 새 버전에서 통하지 않는다 — 백업해 둔다.

## 시험(테스트 결제, 돈 안 나감)

```sh
node payments/dev.mjs                       # 결제 서버 :8787
(cd site && python3 -m http.server 8765)    # 구매 페이지
open "http://127.0.0.1:8765/buy/?api=http://localhost:8787"
```

토스페이를 고르면 QR이 뜬다. 폰으로 찍어 승인하면 완료 페이지에 키가 나온다. 카드는 테스트에서도 카드사 본인 확인을 요구한다.
2026-10-15 이 흐름으로 끝까지 확인했다(발급 키는 `license.rs` 테스트에 남김).

## 수동 발급

```sh
node payments/issue.mjs "받는 사람"
```

## 실제 판매로 바꿀 때

1. 회사 겸업 규정 확인, 사업자등록·통신판매업 신고
2. 토스페이먼츠 가입·전자결제 계약 → 라이브 키(`live_gck_`, `live_gsk_`)
3. 결제 서버 배포: `cd payments && npx wrangler deploy`, 비밀값 `wrangler secret put TOSS_SECRET_KEY`, `wrangler secret put LICENSE_PRIVATE_KEY < ~/.aru/license-private.pem`, KV `LICENSES` 연결
4. `site/buy/config.js`의 `clientKey`·`api`를 라이브로, `testMode: false`
5. 앱 `LICENSING_ENABLED = true`로 배포. 그 전에 앱을 쓰던 사람은 자동으로 "초기 사용자 · 계속 무료"
6. 소개 페이지·README에 가격과 구매 안내 추가, `PRINCIPLES.md`의 "서버 없음"을 "할 일 데이터는 서버로 가지 않음"으로 고치기
