import type { SaveMode } from "./autoSaver";
import type { TodoItem } from "./todoList";

export function saveModeFor(prev: TodoItem[], next: TodoItem[]): SaveMode {
  if (prev.length !== next.length) return "now";
  const onlyTextChanged = prev.every(
    (p, i) =>
      p.id === next[i].id && p.done === next[i].done && p.from === next[i].from && !!p.ai === !!next[i].ai,
  );
  return onlyTextChanged ? "debounce" : "now";
}
