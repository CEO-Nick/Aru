function monthDay(isoDate: string): [number, number] {
  const [, month, day] = isoDate.split("-").map(Number);
  return [month, day];
}

export function fromTagLabel(isoDate: string): string {
  const [month, day] = monthDay(isoDate);
  return `${month}/${day}에서 넘어옴`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function dateLabel(isoDate: string): string {
  const [year] = isoDate.split("-").map(Number);
  const [month, day] = monthDay(isoDate);
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()];
  return `${month}월 ${day}일 (${weekday})`;
}
