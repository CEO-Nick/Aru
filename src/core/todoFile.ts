import { parseDocument, serializeDocument } from "./markdown";
import type { TodoItem } from "./todoList";

export function parseItems(
  markdown: string,
  newId: () => string,
): { items: TodoItem[]; notes: string } {
  const { todos, notes } = parseDocument(markdown);
  return { items: todos.map((todo) => ({ id: newId(), ...todo })), notes };
}

export function dumpItems(items: TodoItem[], notes: string): string {
  return serializeDocument({ todos: items.map(({ id: _id, ...todo }) => todo), notes });
}

/** 빠른 입력창에서 쓴 할 일을 파일 맨 끝 할 일 다음에 붙인다 */
export function appendTodo(markdown: string, text: string): string {
  const { todos, notes } = parseDocument(markdown);
  return serializeDocument({ todos: [...todos, { text: text.trim(), done: false }], notes });
}
