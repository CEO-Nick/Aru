import { addDays, isIsoDate } from "./date";
import type { CarryOver } from "./settings";
import { isBlankTodoText } from "./text";
import type { TodoItem } from "./todoList";

export interface DayItems {
  date: string;
  items: TodoItem[];
  /** 옮기지 않고 그날에 남길 할 일 */
  stay?: Set<TodoItem>;
}

/**
 * 오래 꺼져 있다 켜면 이만큼만 거슬러 올라가 정리한다. 그보다 오래된 날의 미완료는 그날 파일에 그대로 남는다.
 * 켤 때마다 날짜 수만큼 파일을 읽으므로 한도가 없으면 잘못된 기록 하나로 시작이 수십 초 멈춘다
 */
export const MAX_CATCH_UP_DAYS = 400;

export function datesBetween(start: string, endExclusive: string, maxDays = MAX_CATCH_UP_DAYS): string[] {
  if (!isIsoDate(start) || !isIsoDate(endExclusive)) return [];
  const earliest = addDays(endExclusive, -maxDays);
  const dates: string[] = [];
  for (let d = start < earliest ? earliest : start; d < endExclusive; d = addDays(d, 1)) dates.push(d);
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

  // 눈에 빈 할 일(다른 편집기가 쓴 빈 칸 줄)은 옮기지 않고 그 자리에 둔다. 옮긴 파일에는 그 줄의 원래 모양 기록이 없어 쓸 때 사라진다
  const stays = (item: TodoItem) => item.done || (isBlankTodoText(item.text) && !item.children?.length);
  const moved: TodoItem[] = [];
  const remaining = pastDays.map(({ date, items, stay }) => {
    const kept = (item: TodoItem) => stays(item) || !!stay?.has(item);
    for (const item of items) {
      if (!kept(item)) moved.push({ ...item, from: item.from ?? date });
    }
    return { date, items: items.filter(kept) };
  });

  return policy === "next-day"
    ? { pastDays: remaining, today: [...today, ...moved], someday }
    : { pastDays: remaining, today, someday: [...someday, ...moved] };
}
