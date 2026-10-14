import type { Ref } from "vue";
import type { AutoSaver } from "../core/autoSaver";
import { carryOver, datesBetween } from "../core/rollover";
import type { Settings } from "../core/settings";
import { dumpItems, parseItems } from "../core/todoFile";
import type { TodoItem } from "../core/todoList";
import type { FileStore } from "../platform/fileStore";

const newId = () => crypto.randomUUID();
export const dayPath = (date: string) => `daily/${date}.md`;

/**
 * 마지막으로 처리한 날부터 오늘 전날까지의 미완료 항목을 설정대로 옮긴다.
 * 자정을 넘길 때와 앱을 켤 때(며칠 꺼져 있었을 수 있다) 부른다.
 * previousDay: 자정 전환이면 방금까지의 오늘. 기록된 날짜를 믿을 수 없을 때 대신 쓴다.
 */
export async function rollover(
  today: string,
  settings: Ref<Settings>,
  store: FileStore,
  saver: AutoSaver,
  someday: Ref<TodoItem[]>,
  previousDay?: string,
) {
  let last = settings.value.lastRolloverDate;
  if (last === today) return;
  // 기록이 미래면(시계를 되돌렸거나 시차 있는 컴퓨터와 폴더를 함께 씀) 믿지 않는다
  if (last && last > today) last = previousDay && previousDay < today ? previousDay : null;
  if (!last || settings.value.carryOver === "keep") {
    settings.value.lastRolloverDate = today;
    return;
  }

  await saver.flush();
  const dates = datesBetween(last, today);
  const read = async (date: string) => parseItems((await store.read(dayPath(date))) ?? "", newId);
  const past = await Promise.all(dates.map(read));
  const todayDoc = await read(today);

  const result = carryOver(
    settings.value.carryOver,
    dates.map((date, i) => ({ date, items: past[i].items })),
    todayDoc.items,
    someday.value,
  );

  for (const [i, day] of result.pastDays.entries()) {
    if (day.items.length === past[i].items.length) continue;
    saver.schedule(dayPath(day.date), dumpItems(day.items, past[i].notes), "now");
  }
  if (result.today.length !== todayDoc.items.length) {
    saver.schedule(dayPath(today), dumpItems(result.today, todayDoc.notes), "now");
  }
  someday.value = result.someday;
  settings.value.lastRolloverDate = today;
  await saver.flush();
}
