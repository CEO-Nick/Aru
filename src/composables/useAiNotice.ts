import { ref, watch, type Ref } from "vue";
import { removeAiBatch, type TodoItem } from "../core/todoList";

// 이보다 오래전에 넣은 묶음은 "방금 들어온 것"으로 보지 않는다
const RECENT_SECONDS = 120;
const SHOW_MS = 10_000;

export interface AiBatch {
  by: string;
  at: number;
  count: number;
}

/**
 * AI·명령어가 방금 한꺼번에 넣은 할 일을 창 아래에 알리고, 그 묶음을 통째로 되돌릴 수 있게 한다.
 * 원치 않게 들어온 경우(승인 없이 돌리는 AI 등)를 위한 안전장치다.
 */
export function useAiNotice(lists: Ref<TodoItem[]>[]) {
  const notice = ref<AiBatch | null>(null);
  const announced = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const key = (b: { by: string; at: number }) => `${b.by}@${b.at}`;

  function scan() {
    const now = Math.floor(Date.now() / 1000);
    const batches = new Map<string, AiBatch>();
    for (const list of lists) {
      for (const item of list.value) {
        if (!item.ai || now - item.ai.at > RECENT_SECONDS) continue;
        const k = key(item.ai);
        const batch = batches.get(k) ?? { ...item.ai, count: 0 };
        batch.count++;
        batches.set(k, batch);
      }
    }
    const fresh = [...batches.entries()].filter(([k]) => !announced.has(k)).sort(([, a], [, b]) => b.at - a.at);
    if (!fresh.length) return;
    fresh.forEach(([k]) => announced.add(k));
    notice.value = fresh[0][1];
    clearTimeout(timer);
    timer = setTimeout(() => (notice.value = null), SHOW_MS);
  }

  function undo() {
    if (!notice.value) return;
    const batch = notice.value;
    for (const list of lists) {
      if (list.value.some((item) => item.ai && key(item.ai) === key(batch))) {
        list.value = removeAiBatch(list.value, batch);
      }
    }
    notice.value = null;
    clearTimeout(timer);
  }

  watch(lists, scan, { deep: true, immediate: true });

  return { notice, undo };
}
