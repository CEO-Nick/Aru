import { ref, watch, type Ref } from "vue";
import type { AutoSaver } from "../core/autoSaver";
import { saveModeFor } from "../core/changeKind";
import { dumpItems, parseItems } from "../core/todoFile";
import type { TodoItem } from "../core/todoList";
import type { FileStore } from "../platform/fileStore";

const newId = () => crypto.randomUUID();

/**
 * 마크다운 파일 하나와 화면 목록 하나를 잇는다. 목록이 바뀌면 자동저장에 넘기고,
 * 다른 편집기에서 파일이 바뀌었으면 다시 읽는다.
 */
export function useTodoFile(path: Ref<string>, store: FileStore, saver: AutoSaver) {
  const items = ref<TodoItem[]>([]);
  const loaded = ref(false);
  let notes = "";
  let lastKnown: string | null = null;
  let applying = false;

  function apply(content: string | null) {
    applying = true;
    lastKnown = content;
    const parsed = parseItems(content ?? "", newId);
    items.value = parsed.items;
    notes = parsed.notes;
    loaded.value = true;
    queueMicrotask(() => (applying = false));
  }

  async function load() {
    loaded.value = false;
    apply(await store.read(path.value));
  }

  async function reloadIfChanged() {
    // 아직 쓰지 않은 내 변경이 있으면 밖의 내용으로 덮지 않는다
    if (!loaded.value || saver.hasPending(path.value)) return;
    const content = await store.read(path.value);
    if (content !== lastKnown) apply(content);
  }

  watch(items, (next, prev) => {
    if (applying || !loaded.value) return;
    const content = dumpItems(next, notes);
    if (content === lastKnown) return;
    // 한 번도 저장된 적 없는 날짜를 비어 있는 채로 파일로 만들지 않는다
    if (content === "" && lastKnown === null) return;
    lastKnown = content;
    saver.schedule(path.value, content, saveModeFor(prev, next));
  });

  return { items, loaded, load, reloadIfChanged, path };
}
