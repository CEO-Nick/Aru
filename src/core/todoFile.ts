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
