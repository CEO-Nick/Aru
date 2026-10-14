const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

export function splitRatio(pointerY: number, top: number, height: number): number {
  const ratio = (pointerY - top) / height;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}
