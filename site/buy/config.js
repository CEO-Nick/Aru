// 결제 페이지 설정. 실제 판매를 시작할 때 토스 클라이언트 키(live_gck_...)와 결제 서버 주소만 바꾼다.
// 주소 뒤에 ?api=http://localhost:8787 을 붙이면 내 맥에서 돌린 결제 서버로 시험할 수 있다.
window.ARU_PAY = {
  // 토스페이먼츠 문서에 공개된 테스트 클라이언트 키(실제 돈이 오가지 않는다)
  clientKey: "test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm",
  api: new URLSearchParams(location.search).get("api") ?? sessionStorage.getItem("aru-pay-api") ?? "https://aru-pay.workers.dev",
  price: 3900,
  testMode: true,
};
sessionStorage.setItem("aru-pay-api", window.ARU_PAY.api);
