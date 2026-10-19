// 할 일 한 줄에 들어가면 안 되는 글자를 일반 공백으로 바꾼다.
// 파일은 줄 단위라 줄바꿈 계열(U+2028·U+2029·CR)이 남으면 다시 읽을 때 할 일이 메모로 바뀌고,
// WebKit 입력칸이 넣는 NBSP는 같은 글자인데 다른 줄로 비교돼 중복·병합이 어긋난다.
// 앞뒤 공백은 그대로 둔다 — 입력 중인 글자의 끝 공백을 지우면 커서가 튄다
export function normalizeTodoText(text: string): string {
  return text.replace(/\r\n|[\r\n\u2028\u2029\u00a0]/g, " ").replace(/\ufeff/g, "");
}

// 보이지 않는 글자(폭 0 공백·이음/끊음·방향 표시·채움 글자·변이 선택자·태그 글자 등)와 공백만 있으면 눈에는 빈 할 일이다.
// aru 명령(Rust)도 똑같은 목록을 쓴다 — 한쪽만 고치면 앱이 거른 글을 aru가 넣거나 그 반대가 된다.
// 지우지는 않는다 — 이모지 속 ZWJ·VS처럼 글자 사이에서는 뜻이 있다
const INVISIBLE =
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{1D159}\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}\p{White_Space}]/gu;

/** 할 일로 넣을 만한 글자가 없는가(공백과 보이지 않는 글자뿐). 화면·파일·aru 명령이 모두 이 기준 하나를 쓴다 */
export function isBlankTodoText(text: string): boolean {
  return normalizeTodoText(text).replace(INVISIBLE, "") === "";
}
