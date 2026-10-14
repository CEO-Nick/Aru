import { ref, watch, type Ref } from "vue";
import type { AutoSaver } from "../core/autoSaver";
import { saveModeFor } from "../core/changeKind";
import { mergeContent } from "../core/merge";
import { dumpItems, parseItems } from "../core/todoFile";
import type { TodoItem } from "../core/todoList";
import type { FileStore } from "../platform/fileStore";

const newId = () => crypto.randomUUID();

/**
 * 마크다운 파일 하나와 화면 목록 하나를 잇는다. 목록이 바뀌면 자동저장에 넘기고,
 * 다른 창·편집기에서 파일이 바뀌었으면 다시 읽는다. 저장 전인 내 변경이 있으면 합친다.
 */
export function useTodoFile(path: Ref<string>, store: FileStore, saver: AutoSaver) {
  const items = ref<TodoItem[]>([]);
  const loaded = ref(false);
  let notes = "";
  /** 마지막으로 파일과 맞춰 본 내용. 파일이 없으면 "" */
  let lastKnown = "";
  let applying = false;

  // 다시 읽어도 같은 항목은 id를 유지한다. 바뀌면 고치던 칸의 커서가 날아간다
  function apply(content: string) {
    applying = true;
    const parsed = parseItems(content, newId);
    const pool = [...items.value];
    items.value = parsed.items.map((item) => {
      const i = pool.findIndex(
        (old) => old.text === item.text && old.done === item.done && old.from === item.from,
      );
      return i === -1 ? item : { ...item, id: pool.splice(i, 1)[0].id };
    });
    notes = parsed.notes;
    loaded.value = true;
    queueMicrotask(() => (applying = false));
  }

  async function load() {
    loaded.value = false;
    items.value = [];
    lastKnown = (await store.read(path.value)) ?? "";
    apply(lastKnown);
  }

  async function reloadIfChanged() {
    if (!loaded.value) return;
    const target = path.value;
    const content = (await store.read(target)) ?? "";
    if (target !== path.value || content === lastKnown) return;
    if (!saver.hasPending(target)) {
      lastKnown = content;
      apply(content);
      return;
    }
    const merged = mergeContent(lastKnown, dumpItems(items.value, notes), content);
    lastKnown = merged;
    apply(merged);
    saver.schedule(target, merged, "now");
  }

  watch(items, (next, prev) => {
    if (applying || !loaded.value) return;
    const content = dumpItems(next, notes);
    if (content === lastKnown) return;
    lastKnown = content;
    saver.schedule(path.value, content, saveModeFor(prev, next));
  });

  return { items, loaded, load, reloadIfChanged, path };
}
