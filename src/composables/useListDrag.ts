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
  /** 이 목록에 놓을 수 있는가. 읽지 못한 파일의 목록에 놓으면 저장되지 않아 할 일이 사라진다 */
  canDropTo?: (listKey: string) => boolean;
}

/**
 * 손잡이(⋮⋮)를 잡아 끄는 동작. HTML5 드래그는 Tauri 창(특히 윈도우)에서 파일 드롭 처리와 부딪혀서
 * 포인터 이벤트로 직접 구현한다. 목록 계산은 core/todoList가 맡고 여기는 위치 판정만 한다.
 */
/** 목록의 위·아래 가장자리에서 이 거리(px) 안이면 그 쪽으로 스크롤한다 */
const EDGE = 32;
/** 가장자리에 가장 가까울 때 한 프레임에 움직이는 거리(px) */
const MAX_STEP = 14;

/** 스크롤되는 가장 가까운 조상(자기 자신 포함). 목록이 창보다 길 때 그 목록을 감싼 칸이다 */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let e: HTMLElement | null = el; e && e !== document.body; e = e.parentElement) {
    const overflow = getComputedStyle(e).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && e.scrollHeight > e.clientHeight) return e;
  }
  return null;
}

export function useListDrag(lists: Record<string, Ref<TodoItem[]>>, options: DragOptions = {}) {
  const state = reactive<{ draggingId: string | null; sourceKey: string | null; marker: DropMarker | null }>({
    draggingId: null,
    sourceKey: null,
    marker: null,
  });

  function markerAt(x: number, y: number): DropMarker | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    let listEl = el?.closest<HTMLElement>("[data-list]");
    // 목록을 감싼 칸의 여백(맨 위·맨 아래)이면 그 칸의 목록에 놓는다. 끌며 스크롤해 맨 위까지 올라가면 손잡이가 여백에 있다
    if (!listEl && el) {
      const inner = scrollerOf(el)?.querySelectorAll<HTMLElement>("[data-list]");
      if (inner?.length === 1) listEl = inner[0];
    }
    const dateEl = options.onDropToDate ? el?.closest<HTMLElement>("[data-drop-date]") : null;
    if (!listEl && dateEl) return { listKey: "", beforeId: null, date: dateEl.dataset.dropDate! };
    if (!listEl) return null;
    const listKey = listEl.dataset.list!;
    if (options.canDropTo && !options.canDropTo(listKey)) return null;
    const rows = [...listEl.querySelectorAll<HTMLElement>(".item[data-item-id]")];
    const before = rows.find((row) => {
      const rect = row.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    return { listKey, beforeId: before?.dataset.itemId ?? null };
  }

  let pointer = { x: 0, y: 0 };
  let frame = 0;

  // 끄는 동안 매 프레임: 손잡이가 목록 위·아래 가장자리에 있으면 그 쪽으로 스크롤한다.
  // 마우스를 움직이지 않아도 스크롤되면 놓일 자리가 바뀌므로 표시도 다시 계산한다
  function autoScroll() {
    frame = requestAnimationFrame(autoScroll);
    // 목록 위 여백(칸의 안쪽 여백)에 있어도 그 칸을 스크롤한다. 목록을 품은 칸만 스크롤한다
    const under = document.elementFromPoint(pointer.x, pointer.y) as HTMLElement | null;
    const box = under && scrollerOf(under);
    if (!box?.querySelector("[data-list]")) return;
    const rect = box.getBoundingClientRect();
    const depth = pointer.y < rect.top + EDGE ? pointer.y - (rect.top + EDGE) : pointer.y > rect.bottom - EDGE ? pointer.y - (rect.bottom - EDGE) : 0;
    if (!depth) return;
    const step = Math.sign(depth) * Math.ceil(MAX_STEP * Math.min(1, Math.abs(depth) / EDGE));
    const before = box.scrollTop;
    box.scrollTop += step;
    if (box.scrollTop !== before) state.marker = markerAt(pointer.x, pointer.y);
  }

  function onMove(event: PointerEvent) {
    pointer = { x: event.clientX, y: event.clientY };
    state.marker = markerAt(event.clientX, event.clientY);
  }

  function end() {
    state.draggingId = null;
    state.sourceKey = null;
    state.marker = null;
    cancelAnimationFrame(frame);
    frame = 0;
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
    pointer = { x: event.clientX, y: event.clientY };
    document.body.classList.add("dragging");
    frame = requestAnimationFrame(autoScroll);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", onKey, true);
  }

  return { state, start };
}
