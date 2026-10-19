import { ref, watch, type Ref } from "vue";
import type { AutoSaver, SaveMode } from "../core/autoSaver";
import { saveModeFor } from "../core/changeKind";
import { EMPTY_TAIL, dumpItems, mergeTodoContent, parseItems, renameIds, type DocTail } from "../core/todoFile";
import type { TodoItem } from "../core/todoList";
import type { FileStore } from "../platform/fileStore";
import { isRootUnavailable, isUndecodable } from "./useStorageHealth";

const newId = () => crypto.randomUUID();

/**
 * 마크다운 파일 하나와 화면 목록 하나를 잇는다. 목록이 바뀌면 자동저장에 넘기고,
 * 다른 창·편집기에서 파일이 바뀌었으면 다시 읽는다. 저장 전인 내 변경이 있으면 합친다.
 */
export function useTodoFile(path: Ref<string>, store: FileStore, saver: AutoSaver) {
  const items = ref<TodoItem[]>([]);
  const loaded = ref(false);
  /** 읽지 못한 이유. 있으면 목록을 비워 두고 이 파일에는 쓰지 않는다 — 다른 편집기로 고칠 원본을 덮어쓰지 않으려고 */
  const error = ref<string | null>(null);
  let doc: DocTail = EMPTY_TAIL;
  /** 지금 파일에 실제로 들어 있다고 아는 내용(읽었거나 내가 다 쓴 것). 파일이 없으면 "" */
  let fileBase = "";
  /** 화면 목록을 마지막으로 파일 형식으로 만든 내용. 같은 내용을 두 번 저장하지 않으려고 둔다 */
  let lastKnown = "";
  let applying = false;
  /** 지금 items가 어느 파일의 내용인가. 날짜를 바꾼 직후 다시 읽기 전에는 path와 다르다 */
  let itemsPath: string | null = null;

  // 다시 읽어도 같은 항목은 id를 유지한다. 바뀌면 고치던 칸의 커서가 날아간다
  function apply(content: string, target = path.value) {
    applying = true;
    itemsPath = target;
    const parsed = parseItems(content, newId);
    const pool = [...items.value];
    const rename = new Map<string, string>();
    items.value = parsed.items.map((item) => {
      const i = pool.findIndex(
        (old) => old.text === item.text && old.done === item.done && old.from === item.from,
      );
      if (i === -1) return item;
      const id = pool.splice(i, 1)[0].id;
      rename.set(item.id, id);
      return { ...item, id };
    });
    doc = renameIds(parsed.doc, rename);
    loaded.value = true;
    queueMicrotask(() => (applying = false));
  }

  /** 파일 내용을 화면에 들인다. 저장 전인 내 변경이 있으면 그것과 합쳐 들이고 합친 것을 쓴다 */
  function take(target: string, content: string) {
    const pending = saver.pendingFor(target);
    if (!pending) {
      fileBase = lastKnown = content;
      apply(content, target);
      return;
    }
    // 마지막으로 알던 파일 내용을 기준으로 양쪽을 합친다. 기준을 모르는 저장(옛 경로)이면 지금 화면 기준
    const merged = mergeTodoContent(pending.base ?? fileBase, pending.content, content);
    fileBase = content;
    lastKnown = merged;
    apply(merged, target);
    saver.schedule(target, merged, "now", content);
  }

  /** 글자로 풀 수 없는 파일: 목록을 비우고 막는다. 저장 전인 내 변경은 자동저장이 그대로 들고 있다가 다시 읽힐 때 합친다 */
  function fail(e: unknown) {
    loaded.value = false;
    error.value = String(e);
    items.value = [];
    itemsPath = null;
  }

  /**
   * 파일을 새로 읽는다. before(이전 날 저장 마무리)를 기다리는 동안에도 목록은 먼저 비워 둔다 —
   * 머리에는 새 날이 보이는데 이전 날 목록에 적으면 그 글이 이전 날 파일로 간다.
   * before가 실패해도 읽는다. 안 읽으면 머리의 날짜와 목록·저장 대상이 계속 어긋난다
   */
  async function load(before?: () => Promise<unknown>) {
    // 같은 틱에 목록을 고친 뒤(떠나기 전 입력칸 글 넣기 등) 비우면 watch가 고친 것을 보지 못한다. 비우기 전에 예약해 둔다
    if (loaded.value && itemsPath !== null) queueSave(itemsPath, "now");
    loaded.value = false;
    error.value = null;
    items.value = [];
    itemsPath = null;
    const target = path.value;
    await before?.().catch(() => {});
    if (target !== path.value) return;
    let content: string;
    try {
      content = (await store.read(target)) ?? "";
    } catch (e) {
      if (target !== path.value) return;
      if (!isRootUnavailable(e)) return fail(e);
      // 저장 폴더를 열 수 없다: 적을 수는 있게 두고, 폴더가 돌아오면 그때 파일과 합친다.
      // 폴더가 없는 동안 이 파일에 적어 둔 게 있으면(다른 날로 갔다 돌아옴) 그걸 다시 보여 준다
      const held = saver.pendingFor(target);
      fileBase = held?.base ?? "";
      lastKnown = held?.content ?? "";
      apply(lastKnown, target);
      return;
    }
    if (target !== path.value) return;
    take(target, content);
  }

  // 내가 쓴 저장이 끝나면 그게 지금 파일 내용이다. 뒤늦게 도착한 내 저장을 바깥 변경으로 착각하지 않게 한다.
  // 쓰는 순간 바깥 변경과 합쳐 썼으면(aru 명령이 그 사이 넣음) 화면도 합친 내용으로 맞춘다.
  // fileBase는 화면이 들인 내용보다 앞서 가면 안 된다 — 합친 줄을 모르는 화면의 다음 편집이 그 기준으로 성공해 그 줄을 지운다
  // 날짜를 바꾸는 중(flush를 기다리는 동안)에는 아직 이전 날 목록이 떠 있다. 기준은 path가 아니라 그 목록의 파일이다
  saver.onWrite((written, content, scheduled) => {
    if (written !== itemsPath || !loaded.value) return;
    if (content === scheduled) {
      fileBase = content;
      return;
    }
    if (lastKnown === scheduled && !saver.hasPending(written)) {
      fileBase = lastKnown = content;
      apply(content, written);
      return;
    }
    // 쓰는 동안 더 고쳤다: 그 고침 위에 합친 바깥 변경을 바로 얹고, 합친 파일을 기준으로 다시 예약한다
    const merged = mergeTodoContent(scheduled, dumpItems(items.value, doc), content);
    fileBase = content;
    lastKnown = merged;
    apply(merged, written);
    saver.schedule(written, merged, "now", content);
  });

  /** 파일을 다시 읽어 화면과 맞춘다. 읽지 못하면 던진다 */
  async function sync() {
    const target = path.value;
    if (error.value !== null) {
      // 못 읽던 파일이 읽히게 됐으면 처음 읽은 것처럼 채운다. 못 읽기 전에 고친 게 남아 있으면 지금 파일과 합친다
      const content = (await store.read(target)) ?? "";
      if (target !== path.value) return;
      error.value = null;
      take(target, content);
      return;
    }
    // 날짜를 바꾸는 중이라 화면 목록이 아직 이전 날 것이면 새 날 파일과 섞지 않는다. 곧 load가 새로 읽는다
    if (!loaded.value || itemsPath !== target) return;
    let content: string;
    try {
      content = (await store.read(target)) ?? "";
    } catch (e) {
      // 잠깐의 읽기 오류(EIO 등)면 목록을 그대로 두고 다음에 다시 읽는다
      if (isUndecodable(e) && target === path.value) fail(e);
      throw e;
    }
    if (target !== path.value || itemsPath !== target || content === fileBase) return;
    // 쓰는 중인 내 저장이 이미 파일에 들어갔는지 모른다. 지금 합치면 낡은 기준으로 합쳐 같은 할 일의 옛 글이 따로 남는다.
    // 응답이 오면 기준이 그 내용으로 옮겨 가므로, 그 뒤 다시 읽을 때 합친다
    if (saver.writing(target)) return;
    if (!saver.hasPending(target)) {
      fileBase = lastKnown = content;
      apply(content, target);
      return;
    }
    // 저장 전인 내 변경이 있는데 바깥에서도 바뀌었다: 마지막 파일 내용을 기준으로 양쪽을 합친다
    const merged = mergeTodoContent(fileBase, dumpItems(items.value, doc), content);
    fileBase = content;
    lastKnown = merged;
    apply(merged, target);
    saver.schedule(target, merged, "now", content);
  }

  const reloadIfChanged = () => sync().catch(() => {});

  /** 저장 폴더가 돌아왔을 때 밀린 변경을 지금 파일과 합친다. 폴더를 아직 열 수 없으면 던진다 */
  const recover = () =>
    sync().catch((e) => {
      if (isRootUnavailable(e)) throw e;
    });

  /** 저장 폴더가 바뀌었다: 옛 폴더에서 읽은 내용은 더 이상 기준이 아니다. 새 폴더 파일과는 합집합으로 합친다 */
  function forgetBase() {
    fileBase = "";
  }

  /** 화면 목록을 파일 형식으로 만들어, 마지막으로 만든 것과 다르면 저장을 예약한다 */
  function queueSave(target: string, mode: SaveMode) {
    const content = dumpItems(items.value, doc);
    if (content === lastKnown) return;
    lastKnown = content;
    saver.schedule(target, content, mode, fileBase);
  }

  watch(items, (next, prev) => {
    if (applying || !loaded.value) return;
    queueSave(itemsPath ?? path.value, saveModeFor(prev, next));
  });

  /** 화면에 지금 이 파일 내용이 열려 있으면 그 목록. 날짜를 바꾸고 아직 읽기 전이거나 못 읽은 파일이면 null */
  function openList() {
    return loaded.value && error.value === null && itemsPath === path.value ? { path: itemsPath, items } : null;
  }

  return { items, loaded, error, load, reloadIfChanged, recover, forgetBase, openList, path };
}
