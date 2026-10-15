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

/** 빠른 입력창에서 쓴 할 일은 맨 위에 넣는다. 다른 앱을 쓰다 적은 일이라 창을 보면 바로 보여야 한다 */
export function prependTodo(markdown: string, text: string): string {
  const { todos, notes } = parseDocument(markdown);
  return serializeDocument({ todos: [{ text: text.trim(), done: false }, ...todos], notes });
}
