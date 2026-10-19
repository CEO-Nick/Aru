import type { Ref } from "vue";
import type { AutoSaver } from "../core/autoSaver";
import { addDays } from "../core/date";
import { carryOver, datesBetween, MAX_CATCH_UP_DAYS } from "../core/rollover";
import type { Settings } from "../core/settings";
import { dumpItems, parseItems } from "../core/todoFile";
import type { TodoItem } from "../core/todoList";
import type { FileStore } from "../platform/fileStore";
import { isRootUnavailable } from "./useStorageHealth";

const newId = () => crypto.randomUUID();
export const dayPath = (date: string) => `daily/${date}.md`;

export interface RolloverResult {
  /** 읽지 못해 건너뛴 지난 날짜 파일. 그 파일에는 아무것도 쓰지 않았다 */
  unreadable: string[];
}

/** 화면 목록에 열려 있는 파일과 그 목록 */
export interface OpenList {
  path: string;
  items: Ref<TodoItem[]>;
}

/**
 * 마지막으로 처리한 날부터 오늘 전날까지의 미완료 항목을 설정대로 옮긴다.
 * 자정을 넘길 때와 앱을 켤 때(며칠 꺼져 있었을 수 있다) 부른다.
 * previousDay: 자정 전환이면 방금까지의 오늘. 기록된 날짜를 믿을 수 없을 때 대신 쓴다.
 * openLists: 지금 화면 목록에 열린 파일들(오늘이든 보고 있던 지난 날이든). 그 파일은 따로 쓰지 않고 목록을 고친다 —
 *   파일에 따로 쓰면 화면이 모르는 채 남아 다음 편집이 옮긴 할 일을 되살린다. 목록의 저장 전 고침도 함께 옮긴다.
 * 지난 날 파일 하나를 못 읽어도 나머지 날은 옮기고, 못 읽은 날만 rolloverPending에 남겨 다음에 그 날만 다시 시도한다 —
 *   정리한 날까지 다시 정리하면 사용자가 그 뒤 그 날에 새로 적은 할 일이 옮겨진다.
 * deferred: 쓰는 중이라 미룬 날마다 미룬 그때의 미완료 할 일 글. 다시 정리할 때 이 글들만 옮긴다 — 그 날은 계속 열려 있어
 *   사용자가 그 뒤 새로 적은 할 일("기록용")까지 옮기면 안 된다(리뷰 L5). 메모리에만 두므로 다시 켜면 그날 전체를 옮긴다
 */
export async function rollover(
  today: string,
  settings: Ref<Settings>,
  store: FileStore,
  saver: AutoSaver,
  someday: Ref<TodoItem[]>,
  {
    previousDay,
    openLists = () => [],
    deferred = new Map(),
  }: { previousDay?: string; openLists?: () => OpenList[]; deferred?: Map<string, string[]> } = {},
): Promise<RolloverResult> {
  const recorded = settings.value.lastRolloverDate;
  const earliest = addDays(today, -MAX_CATCH_UP_DAYS);
  const pending = (settings.value.rolloverPending ?? []).filter((date) => date < today && date >= earliest);
  if (recorded === today && !pending.length) return { unreadable: [] };
  const finish = (left: string[]) => {
    settings.value.lastRolloverDate = today;
    if (left.length) settings.value.rolloverPending = left;
    else delete settings.value.rolloverPending;
  };
  // 기록이 미래면(시계를 되돌렸거나 시차 있는 컴퓨터와 폴더를 함께 씀) 믿지 않는다
  let last = recorded && recorded > today ? (previousDay && previousDay < today ? previousDay : null) : recorded;
  if (recorded === null && settings.value.carryOver !== "keep") last = await latestPastDay(today, store);
  if ((!last && !pending.length) || settings.value.carryOver === "keep") {
    finish([]);
    return { unreadable: [] };
  }

  await saver.flush();
  // 쓰지 못하고 남은 편집이 있으면(저장 실패가 이어지는 날) 파일이 아니라 그 편집에서 옮기고 그 기준으로 다시 예약한다.
  // 파일에서 옮겨 예약하면 그 편집을 통째로 덮는다
  const read = async (date: string) => {
    const held = saver.pendingFor(dayPath(date));
    if (held) return { raw: held.base, ...parseItems(held.content, newId) };
    const raw = (await store.read(dayPath(date))) ?? "";
    return { raw: raw as string | undefined, ...parseItems(raw, newId) };
  };
  const past: ({ date: string } & Awaited<ReturnType<typeof read>>)[] = [];
  const unreadable: string[] = [];
  /** 이번에 옮기지 못해 다음 정리에서 다시 볼 날 */
  const left: string[] = [];
  for (const date of [...new Set([...pending, ...(last ? datesBetween(last, today) : [])])].sort()) {
    // 쓰는 중인 편집(그 사이 바깥 변경과 합쳐질 수 있다)이나 기준을 모르는("") 편집에서 할 일을 빼 예약하면,
    // 그 쓰기와 합칠 때 뺀 할 일이 "상대가 더한 줄"로 살아남아 옮긴 날과 이날 양쪽에 생긴다. 그 쓰기가 끝난 뒤로 미룬다
    const held = saver.pendingFor(dayPath(date));
    if (held && (saver.writing(dayPath(date)) || !held.base)) {
      if (!deferred.has(date)) deferred.set(date, parseItems(held.content, newId).items.filter((i) => !i.done).map((i) => i.text));
      left.push(date);
      continue;
    }
    try {
      past.push({ date, ...(await read(date)) });
    } catch (e) {
      // 폴더를 열 수 없으면 어느 날도 믿을 수 없다. 다음에 통째로 다시 한다
      if (isRootUnavailable(e)) throw e;
      unreadable.push(date);
      left.push(date);
    }
  }
  let todayDoc: Awaited<ReturnType<typeof read>> | null = null;
  let todayError: unknown = null;
  try {
    todayDoc = await read(today);
  } catch (e) {
    if (isRootUnavailable(e)) throw e;
    // 오늘이 목록에 열려 있으면 목록으로 옮기므로 파일을 못 읽어도 된다
    todayError = e;
  }

  // 여기서부터 목록에 넣을 때까지 기다리지 않는다. 읽는 동안 다른 날로 옮겨 갔을 수 있어 지금 열린 목록을 여기서 본다
  const open = new Map(openLists().map((l) => [l.path, l.items]));
  const listFor = (date: string) => open.get(dayPath(date));
  const pastItems = past.map(({ date, items }) => listFor(date)?.value ?? items);
  const todayList = listFor(today);
  if (!todayList && !todayDoc) throw todayError;
  const todayItems = todayList?.value ?? todayDoc!.items;
  /** 미룬 그때 없던 할 일. 그 날에 남긴다 */
  const lateIn = (date: string, items: TodoItem[]) => {
    const texts = deferred.get(date);
    if (!texts) return undefined;
    const left = [...texts];
    return new Set(
      items.filter((item) => {
        const i = left.indexOf(item.text);
        if (i >= 0 && !item.done) left.splice(i, 1);
        return i < 0;
      }),
    );
  };
  const result = carryOver(
    settings.value.carryOver,
    past.map(({ date }, i) => ({ date, items: pastItems[i], stay: lateIn(date, pastItems[i]) })),
    todayItems,
    someday.value,
  );
  // 목록에서 옮겨 온 항목은 원래 목록의 id를 지니므로 새 id를 준다
  const fresh = (list: TodoItem[], before: TodoItem[]) => [...before, ...list.slice(before.length).map((item) => ({ ...item, id: newId() }))];

  for (const [i, day] of result.pastDays.entries()) {
    if (day.items.length === pastItems[i].length) continue;
    const list = listFor(day.date);
    if (list) list.value = day.items;
    else saver.schedule(dayPath(day.date), dumpItems(day.items, past[i].doc), "now", past[i].raw);
  }
  const nextToday = fresh(result.today, todayItems);
  if (todayList) todayList.value = nextToday;
  else if (nextToday.length !== todayItems.length) {
    saver.schedule(dayPath(today), dumpItems(nextToday, todayDoc!.doc), "now", todayDoc!.raw);
  }
  someday.value = fresh(result.someday, someday.value);
  finish(left);
  for (const { date } of past) deferred.delete(date);
  await saver.flush();
  return { unreadable: unreadable.map(dayPath) };
}

/** 정리 기록이 없는 폴더(설정 없이 할 일만 있던 폴더를 골랐음)의 가장 최근 지난 날. 기록이 없다고 오늘로 두면 그 폴더의 남은 일이 지난 날에 묻힌다 */
async function latestPastDay(today: string, store: FileStore): Promise<string | null> {
  for (const date of datesBetween(addDays(today, -MAX_CATCH_UP_DAYS), today).reverse()) {
    try {
      if ((await store.read(dayPath(date))) !== null) return date;
    } catch (e) {
      if (isRootUnavailable(e)) throw e;
      return date;
    }
  }
  return null;
}

/**
 * 한 번에 하나만 돌게 한다. 앞 실행이 끝나면 다음 실행이 이어서 돈다(이미 정리했으면 바로 끝난다).
 * 두 곳(창 focus·3초 확인)이 동시에 부르면 둘 다 같은 지난 할 일을 읽어 옮긴 할 일이 둘이 된다
 */
export function serialized<A extends unknown[], R>(run: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (...args: A) => {
    const next = tail.then(() => run(...args));
    tail = next.catch(() => {});
    return next;
  };
}
