import { addDays } from "./date";
import type { CarryOver } from "./settings";
import type { TodoItem } from "./todoList";

export interface DayItems {
  date: string;
  items: TodoItem[];
}

export function datesBetween(start: string, endExclusive: string): string[] {
  const dates: string[] = [];
  for (let d = start; d < endExclusive; d = addDays(d, 1)) dates.push(d);
  return dates;
}

/** 지나간 날들의 미완료 항목을 정책대로 옮긴다. pastDays는 오래된 날부터 */
export function carryOver(
  policy: CarryOver,
  pastDays: DayItems[],
  today: TodoItem[],
  someday: TodoItem[],
): { pastDays: DayItems[]; today: TodoItem[]; someday: TodoItem[] } {
  if (policy === "keep") return { pastDays, today, someday };

  const moved: TodoItem[] = [];
  const remaining = pastDays.map(({ date, items }) => {
    for (const item of items) {
      if (!item.done) moved.push({ ...item, from: item.from ?? date });
    }
    return { date, items: items.filter((item) => item.done) };
  });

  return policy === "next-day"
    ? { pastDays: remaining, today: [...today, ...moved], someday }
    : { pastDays: remaining, today, someday: [...someday, ...moved] };
}
