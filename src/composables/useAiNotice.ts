import { ref, watch, type Ref } from "vue";
import { removeAiBatch, type TodoItem } from "../core/todoList";
import { dumpItems, parseItems } from "../core/todoFile";
import type { FileStore } from "../platform/fileStore";

// 이보다 오래전에 넣은 묶음은 "방금 들어온 것"으로 보지 않는다
const RECENT_SECONDS = 120;
const SHOW_MS = 60_000;

export interface AiBatch {
  by: string;
  at: number;
  count: number;
  /** 넣은 파일(daily/YYYY-MM-DD.md 또는 someday.md) */
  path: string;
}

export interface ShownList {
  path: Ref<string>;
  items: Ref<TodoItem[]>;
}

interface Options {
  /** 지금 화면에 보이는 목록들. 여기 있는 파일은 화면 목록을 고쳐 저장한다 */
  shown: ShownList[];
  store: FileStore;
  /** aru 명령이 남긴 최근 추가 기록. 화면에 안 보이는 날짜에 넣은 것도 여기서 안다 */
  recentBatches: () => Promise<AiBatch[]>;
  todayPath: () => string;
}

const key = (b: { by: string; at: number }) => `${b.by}@${b.at}`;
const marker = (b: { by: string; at: number }) => `ai:${b.by}@${b.at}`;

/** 알림 문구에 붙일 위치. 오늘이면 붙이지 않는다 */
export function placeLabel(path: string, todayPath: string): string {
  if (path === todayPath) return "";
  if (path === "someday.md") return "언젠가에 ";
  const m = /daily\/\d{4}-(\d{2})-(\d{2})\.md$/.exec(path);
  return m ? `${Number(m[1])}/${Number(m[2])}에 ` : "";
}

/**
 * AI·명령어가 방금 한꺼번에 넣은 할 일을 창 아래에 알리고, 그 묶음을 통째로 되돌릴 수 있게 한다.
 * 원치 않게 들어온 경우(승인 없이 돌리는 AI 등)를 위한 안전장치다.
 */
export function useAiNotice({ shown, store, recentBatches, todayPath }: Options) {
  const notice = ref<AiBatch | null>(null);
  const announced = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const shownFor = (path: string) => shown.find((l) => l.path.value === path);

  function show(batch: AiBatch) {
    announced.add(key(batch));
    notice.value = batch;
    clearTimeout(timer);
    timer = setTimeout(() => (notice.value = null), SHOW_MS);
  }

  function hide() {
    notice.value = null;
    clearTimeout(timer);
  }

  const isRecent = (at: number) => Math.floor(Date.now() / 1000) - at <= RECENT_SECONDS;

  /** 화면에 보이는 목록에서 방금 들어온 묶음을 찾는다 */
  function scanShown() {
    const found = new Map<string, AiBatch>();
    for (const list of shown) {
      for (const item of list.items.value) {
        if (!item.ai || !isRecent(item.ai.at)) continue;
        const k = key(item.ai);
        const batch = found.get(k) ?? { ...item.ai, count: 0, path: list.path.value };
        batch.count++;
        found.set(k, batch);
      }
    }
    const fresh = [...found.values()].filter((b) => !announced.has(key(b))).sort((a, b) => b.at - a.at);
    if (fresh.length) show(fresh[0]);
  }

  /** 묶음의 할 일이 모두 확인·수정·삭제됐으면 되돌릴 게 없으니 알림을 내린다 */
  async function hideIfGone() {
    const batch = notice.value;
    if (!batch) return;
    const list = shownFor(batch.path);
    const remaining = list
      ? list.items.value.some((item) => item.ai && key(item.ai) === key(batch))
      : ((await store.read(batch.path)) ?? "").includes(marker(batch));
    if (!remaining && notice.value === batch) hide();
  }

  /** aru 명령의 기록을 확인한다. 앱이 주기적으로 부른다 */
  async function poll() {
    const logged = (await recentBatches().catch(() => [])).filter((b) => isRecent(b.at) && !announced.has(key(b)));
    logged.sort((a, b) => b.at - a.at);
    if (logged.length) show(logged[0]);
    await hideIfGone();
  }

  async function undo() {
    const batch = notice.value;
    if (!batch) return;
    hide();
    const list = shownFor(batch.path);
    if (list) {
      list.items.value = removeAiBatch(list.items.value, batch);
      return;
    }
    const content = (await store.read(batch.path)) ?? "";
    let n = 0;
    const { items, notes } = parseItems(content, () => `u${++n}`);
    await store.write(batch.path, dumpItems(removeAiBatch(items, batch), notes));
  }

  watch(
    shown.map((l) => l.items),
    () => {
      scanShown();
      void hideIfGone();
    },
    { deep: true, immediate: true },
  );

  return { notice, undo, poll, label: (b: AiBatch) => placeLabel(b.path, todayPath()) };
}
