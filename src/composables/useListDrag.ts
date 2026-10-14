import { reactive, type Ref } from "vue";
import { moveBefore, transfer, type TodoItem } from "../core/todoList";

export interface DropMarker {
  listKey: string;
  /** 이 항목 앞에 놓인다. null이면 목록 맨 끝 */
  beforeId: string | null;
  /** 목록이 아니라 달력 날짜 칸 위에 놓일 때 그 날짜 */
  date?: string;
}

export interface DragOptions {
  /** 달력 날짜 칸([data-drop-date])에 놓았을 때. 없으면 날짜 칸은 놓을 곳이 아니다 */
  onDropToDate?: (sourceKey: string, id: string, date: string) => void;
}

/**
 * 손잡이(⋮⋮)를 잡아 끄는 동작. HTML5 드래그는 Tauri 창(특히 윈도우)에서 파일 드롭 처리와 부딪혀서
 * 포인터 이벤트로 직접 구현한다. 목록 계산은 core/todoList가 맡고 여기는 위치 판정만 한다.
 */
export function useListDrag(lists: Record<string, Ref<TodoItem[]>>, options: DragOptions = {}) {
  const state = reactive<{ draggingId: string | null; sourceKey: string | null; marker: DropMarker | null }>({
    draggingId: null,
    sourceKey: null,
    marker: null,
  });

  function markerAt(x: number, y: number): DropMarker | null {
    const el = document.elementFromPoint(x, y);
    const listEl = el?.closest<HTMLElement>("[data-list]");
    const dateEl = options.onDropToDate ? el?.closest<HTMLElement>("[data-drop-date]") : null;
    if (!listEl && dateEl) return { listKey: "", beforeId: null, date: dateEl.dataset.dropDate! };
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

  function end() {
    state.draggingId = null;
    state.sourceKey = null;
    state.marker = null;
    document.body.classList.remove("dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("keydown", onKey, true);
  }

  function onUp() {
    const { draggingId, sourceKey, marker } = state;
    if (draggingId && sourceKey && marker?.date) {
      options.onDropToDate?.(sourceKey, draggingId, marker.date);
    } else if (draggingId && sourceKey && marker) {
      const source = lists[sourceKey];
      const target = lists[marker.listKey];
      if (marker.listKey === sourceKey) {
        source.value = moveBefore(source.value, draggingId, marker.beforeId);
      } else if (target) {
        [source.value, target.value] = transfer(source.value, target.value, draggingId, marker.beforeId);
      }
    }
    end();
  }

  // Esc로 드래그를 취소한다. 목록은 그대로 둔다
  function onKey(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    end();
  }

  function start(listKey: string, id: string, event: PointerEvent) {
    event.preventDefault();
    state.draggingId = id;
    state.sourceKey = listKey;
    document.body.classList.add("dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", onKey, true);
  }

  return { state, start };
}
