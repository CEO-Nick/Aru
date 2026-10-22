import { addDays, MAX_DATE, toIsoDate } from "./date";
import type { TodoItem } from "./todoList";

/** month는 "YYYY-MM" */
export function monthGrid(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const start = addDays(toIsoDate(first), -first.getDay());
  const end = addDays(toIsoDate(last), 6 - last.getDay());
  // 문자열로 비교하면 10000년이 9999년보다 앞선다. 끝 칸이나 날짜 범위의 끝에서 멈춘다
  const days: string[] = [];
  for (let d = start; ; d = addDays(d, 1)) {
    days.push(d);
    if (d === end || d === MAX_DATE) return days;
  }
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return toIsoDate(new Date(y, m - 1 + delta, 1)).slice(0, 7);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}년 ${m}월`;
}

export function monthSummary(
  month: string,
  itemsByDate: Record<string, TodoItem[]>,
): { done: number; pending: number } {
  let done = 0;
  let pending = 0;
  for (const [date, items] of Object.entries(itemsByDate)) {
    if (!date.startsWith(month)) continue;
    for (const item of items) item.done ? done++ : pending++;
  }
  return { done, pending };
}
