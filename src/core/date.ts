// toISOString()은 UTC 기준이라 한국 시간 오전 9시 전에는 하루 전 날짜가 나온다
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  // new Date(y, …)는 0~99년을 1900년대로 바꾼다
  const date = new Date(2000, 0, 1);
  date.setFullYear(y, m - 1, d + days);
  return toIsoDate(date);
}

export function toIsoDate(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 날짜 파일 이름(daily/YYYY-MM-DD.md)이 네 자리 연도로 정렬되는 범위. 그 밖으로 옮기면 daily/10000-01-01.md 같은 파일이 생긴다
export const MIN_DATE = "1970-01-01";
export const MAX_DATE = "9999-12-31";

/** 날짜를 옮길 수 있는 범위 안의, 달력에 실제로 있는 날짜인가. 2026-02-31 같은 값이면 그 이름의 파일이 생긴다 */
export const inDateRange = (date: string) => isIsoDate(date) && date >= MIN_DATE && date <= MAX_DATE;

/** 달력에 실제로 있는 YYYY-MM-DD인가. 손으로 고친 파일의 2026-13-45 같은 값을 거른다 */
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}

export function msUntilNextMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}
