import type { TodoLine } from "./markdown";

export interface TodoItem extends TodoLine {
  id: string;
}

export function toggle(list: TodoItem[], id: string): TodoItem[] {
  return list.map((item) => (item.id === id ? { ...item, done: !item.done } : item));
}

export function updateText(list: TodoItem[], id: string, text: string): TodoItem[] {
  return list.map((item) => (item.id === id ? { ...item, text } : item));
}

/** afterId가 null이면 맨 끝에 붙인다 */
export function insertAfter(
  list: TodoItem[],
  afterId: string | null,
  item: TodoItem,
): TodoItem[] {
  const index = afterId === null ? -1 : list.findIndex((t) => t.id === afterId);
  if (index === -1) return [...list, item];
  return [...list.slice(0, index + 1), item, ...list.slice(index + 1)];
}

export function remove(list: TodoItem[], id: string): TodoItem[] {
  return list.filter((item) => item.id !== id);
}

/** beforeId 항목 앞으로 옮긴다. null이면 맨 끝으로 */
export function moveBefore(
  list: TodoItem[],
  id: string,
  beforeId: string | null,
): TodoItem[] {
  const item = list.find((t) => t.id === id);
  if (!item || beforeId === id) return list;
  return insertBefore(remove(list, id), beforeId, item);
}

/** 오늘 ↔ 언젠가처럼 다른 목록으로 옮긴다. [옮긴 뒤 원래 목록, 옮긴 뒤 대상 목록] */
export function transfer(
  from: TodoItem[],
  to: TodoItem[],
  id: string,
  beforeId: string | null,
): [TodoItem[], TodoItem[]] {
  const item = from.find((t) => t.id === id);
  if (!item) return [from, to];
  return [remove(from, id), insertBefore(to, beforeId, item)];
}

/** "10/12에서 넘어옴" 꼬리표를 지운다 */
export function clearFrom(list: TodoItem[], id: string): TodoItem[] {
  return list.map((item) => {
    if (item.id !== id) return item;
    const { from: _from, ...rest } = item;
    return rest;
  });
}

function insertBefore(list: TodoItem[], beforeId: string | null, item: TodoItem): TodoItem[] {
  const index = beforeId === null ? -1 : list.findIndex((t) => t.id === beforeId);
  if (index === -1) return [...list, item];
  return [...list.slice(0, index), item, ...list.slice(index)];
}
