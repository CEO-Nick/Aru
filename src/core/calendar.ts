import { addDays, toIsoDate } from "./date";
import type { TodoItem } from "./todoList";

/** month는 "YYYY-MM" */
export function monthGrid(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = addDays(toIsoDate(first), -mondayOffset);
  const sundayOffset = (7 - last.getDay()) % 7;
  const end = addDays(toIsoDate(last), sundayOffset);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
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
