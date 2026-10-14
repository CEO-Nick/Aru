// 슬라이더를 끝까지 내려도 창이 완전히 사라지지 않도록 바닥을 둔다
const MIN_ALPHA = 0.2;

export function sliderToAlpha(slider: number): number {
  const clamped = Math.min(100, Math.max(0, slider));
  return MIN_ALPHA + (1 - MIN_ALPHA) * (clamped / 100);
}
