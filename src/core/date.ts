// toISOString()은 UTC 기준이라 한국 시간 오전 9시 전에는 하루 전 날짜가 나온다
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return toIsoDate(new Date(y, m - 1, d + days));
}

export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
