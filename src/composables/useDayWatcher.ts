import { msUntilNextMidnight } from "../core/date";

/**
 * 날짜가 바뀌었는지 확인할 때를 알린다: 자정 정각, 30초마다(잠자기에서 깨어나면 정각 타이머가
 * 늦게 돌 수 있다), 창이 다시 활성화될 때.
 */
export function watchDayChange(check: () => void) {
  const scheduleMidnight = () => {
    setTimeout(() => {
      check();
      scheduleMidnight();
    }, msUntilNextMidnight(new Date()) + 200);
  };
  scheduleMidnight();
  setInterval(check, 30_000);
  window.addEventListener("focus", check);
}
