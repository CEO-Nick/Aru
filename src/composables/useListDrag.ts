import { reactive, type Ref } from "vue";
import { moveBefore, transfer, type TodoItem } from "../core/todoList";

export interface DropMarker {
  listKey: string;
  /** 이 항목 앞에 놓인다. null이면 목록 맨 끝 */
  beforeId: string | null;
}

/**
 * 손잡이(⋮⋮)를 잡아 끄는 동작. HTML5 드래그는 Tauri 창(특히 윈도우)에서 파일 드롭 처리와 부딪혀서
 * 포인터 이벤트로 직접 구현한다. 목록 계산은 core/todoList가 맡고 여기는 위치 판정만 한다.
 */
export function useListDrag(lists: Record<string, Ref<TodoItem[]>>) {
  const state = reactive<{ draggingId: string | null; sourceKey: string | null; marker: DropMarker | null }>({
    draggingId: null,
    sourceKey: null,
    marker: null,
  });

  function markerAt(x: number, y: number): DropMarker | null {
    const el = document.elementFromPoint(x, y);
    const listEl = el?.closest<HTMLElement>("[data-list]");
    if (!listEl) return null;
    const listKey = listEl.dataset.list!;
    const rows = [...listEl.querySelectorAll<HTMLElement>(".item[data-item-id]")];
    const before = rows.find((row) => {
      const rect = row.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    return { listKey, beforeId: before?.dataset.itemId ?? null };
  }

  function onMove(event: PointerEvent) {
    state.marker = markerAt(event.clientX, event.clientY);
  }

  function onUp() {
    const { draggingId, sourceKey, marker } = state;
    if (draggingId && sourceKey && marker) {
      const source = lists[sourceKey];
      const target = lists[marker.listKey];
      if (marker.listKey === sourceKey) {
        source.value = moveBefore(source.value, draggingId, marker.beforeId);
      } else {
        [source.value, target.value] = transfer(source.value, target.value, draggingId, marker.beforeId);
      }
    }
    state.draggingId = null;
    state.sourceKey = null;
    state.marker = null;
    document.body.classList.remove("dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }

  function start(listKey: string, id: string, event: PointerEvent) {
    event.preventDefault();
    state.draggingId = id;
    state.sourceKey = listKey;
    document.body.classList.add("dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return { state, start };
}
