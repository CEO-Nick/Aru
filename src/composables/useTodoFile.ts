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
  /** 지금 파일에 실제로 들어 있다고 아는 내용(읽었거나 내가 다 쓴 것). 파일이 없으면 "" */
  let fileBase = "";
  /** 화면 목록을 마지막으로 파일 형식으로 만든 내용. 같은 내용을 두 번 저장하지 않으려고 둔다 */
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
    fileBase = lastKnown = (await store.read(path.value)) ?? "";
    apply(lastKnown);
  }

  // 내가 쓴 저장이 끝나면 그게 지금 파일 내용이다. 뒤늦게 도착한 내 저장을 바깥 변경으로 착각하지 않게 한다
  saver.onWrite((written, content) => {
    if (written === path.value) fileBase = content;
  });

  async function reloadIfChanged() {
    if (!loaded.value) return;
    const target = path.value;
    const content = (await store.read(target)) ?? "";
    if (target !== path.value || content === fileBase) return;
    if (!saver.hasPending(target)) {
      fileBase = lastKnown = content;
      apply(content);
      return;
    }
    // 저장 전인 내 변경이 있는데 바깥에서도 바뀌었다: 마지막 파일 내용을 기준으로 양쪽을 합친다
    const merged = mergeContent(fileBase, dumpItems(items.value, notes), content);
    fileBase = content;
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
