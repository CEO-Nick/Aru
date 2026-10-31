<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Directive } from "vue";
import type { DropMarker } from "../composables/useListDrag";
import { keepDraft, keptDraft } from "../core/draftStash";
import { aiTagTitle, fromTagLabel } from "../core/format";
import { parseTodos } from "../core/markdown";
import { isBlankTodoText, normalizeTodoText } from "../core/text";
import {
  clearFrom,
  acceptAi,
  insertAfter,
  insertAfterOpen,
  remove,
  settleChecked,
  withoutAi,
  toggle,
  updateText,
  type TodoItem,
} from "../core/todoList";

const items = defineModel<TodoItem[]>({ required: true });
const props = defineProps<{
  placeholder: string;
  /** 체크하면 0.5초 뒤 끝낸 일들 위로 옮긴다(설정) */
  sortChecked?: boolean;
  listKey?: string;
  marker?: DropMarker | null;
  draggingId?: string | null;
  /** 이 목록에 새로 적을 수 없는 이유(파일을 읽지 못함 등). 있으면 입력칸 대신 보여 준다 */
  blocked?: string | null;
  /** 입력칸 글을 이 맥에 남겨 둘 자리(창.목록). 주면 새로 만들 때 그 글을 되돌린다 */
  draftSlot?: string;
  /** 맨 위에서 ↑, 입력칸에서 ↓를 누르면 옮겨 갈 이웃 목록. 주지 않으면 그 자리에 머문다 */
  leaveUp?: () => void;
  leaveDown?: () => void;
}>();
const cannotAdd = computed(() => !!props.blocked);
const emit = defineEmits<{ "drag-start": [id: string, event: PointerEvent] }>();

function isDropBefore(id: string | null) {
  return !!props.marker && props.marker.listKey === props.listKey && props.marker.beforeId === id;
}

const draft = ref(props.draftSlot ? keptDraft(props.draftSlot) : "");
// 넣거나 비우는 즉시 지워야 종료·새로고침 직후 다시 열 때 같은 글이 또 돌아오지 않는다
if (props.draftSlot) watch(draft, (text) => keepDraft(props.draftSlot!, text), { flush: "sync" });
const root = ref<HTMLElement>();
const addRow = ref<HTMLElement>();

function textOf(id: string) {
  return root.value?.querySelector<HTMLElement>(`.text[data-id="${id}"]`) ?? undefined;
}

/** caret: 글자 안 위치(0부터). 생략하면 글자 끝 */
async function focusItem(id: string, caret?: number) {
  await nextTick();
  const el = textOf(id);
  if (!el) return;
  el.focus();
  if (caret === undefined) caretToEnd(el);
  else caretAt(el, caret);
  reveal(el);
}

function caretAt(el: HTMLElement, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const node = el.firstChild;
  const range = document.createRange();
  if (node?.nodeType === Node.TEXT_NODE) range.setStart(node, Math.min(offset, node.textContent?.length ?? 0));
  else range.setStart(el, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 할 일 글자 안에서 지금 선택된 범위(글자 위치). 글자 밖이면 null */
function selectionIn(el: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const offset = (container: Node, at: number) => {
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(container, at);
    return pre.toString().length;
  };
  return { start: offset(range.startContainer, range.startOffset), end: offset(range.endContainer, range.endOffset) };
}

function caretToEnd(el: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function reveal(el: Element | undefined) {
  el?.scrollIntoView?.({ block: "nearest" });
}

function newItem(text: string, done = false): TodoItem {
  return { id: crypto.randomUUID(), text, done };
}

// 한글 조합을 확정하는 Enter와 실제 Enter가 따로 온다. 앞의 것을 무시해야 두 번 추가되지 않는다
function isEnter(event: KeyboardEvent) {
  return event.key === "Enter" && !event.isComposing && event.keyCode !== 229;
}

// Cmd·Ctrl·Alt+Enter는 다른 앱의 단축키라 손에 익은 사람이 누른다. 나누기·추가로 받으면 빈 할 일이 쌓인다
function isPlainEnter(event: KeyboardEvent) {
  return isEnter(event) && !event.metaKey && !event.ctrlKey && !event.altKey;
}

// 줄이 접혀 여러 줄로 보이는 항목에서는 첫 줄·마지막 줄에서만 다른 항목으로 넘어간다
function caretOnEdgeLine(el: HTMLElement, edge: "first" | "last") {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return true;
  const caret = selection.getRangeAt(0).getBoundingClientRect?.();
  if (!caret || caret.height === 0) return true;
  const box = el.getBoundingClientRect();
  return edge === "first" ? caret.top - box.top < caret.height : box.bottom - caret.bottom < caret.height;
}

function focusAddInput() {
  const input = addRow.value?.querySelector("input");
  input?.focus();
  reveal(addRow.value);
}

function onArrow(event: KeyboardEvent, item: TodoItem | null) {
  const index = item ? items.value.findIndex((t) => t.id === item.id) : items.value.length;
  if (event.key === "ArrowUp") {
    const el = item ? textOf(item.id) : undefined;
    if (el && !caretOnEdgeLine(el, "first")) return;
    if (index === 0) {
      if (!props.leaveUp) return;
      event.preventDefault();
      return props.leaveUp();
    }
    event.preventDefault();
    focusItem(items.value[index - 1].id);
  } else if (item) {
    const el = textOf(item.id);
    if (el && !caretOnEdgeLine(el, "last")) return;
    event.preventDefault();
    const next = items.value[index + 1];
    if (next) focusItem(next.id);
    else focusAddInput();
  }
}

// 할 일 한 줄 안에 줄바꿈이 들어오는 입력은 막는다(Enter는 따로 나누기로 처리한다)
function onItemBeforeInput(event: InputEvent) {
  if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") event.preventDefault();
}

function onItemInput(event: Event, item: TodoItem) {
  const el = event.target as HTMLElement;
  // WebKit은 줄바꿈을 <br>로 넣어 textContent에 안 잡힌다. 화면에 보이는 그대로(innerText) 읽는다
  const hasBreak = el.querySelector("br, div, p") !== null;
  // 칸을 다 지우면 브라우저가 자리 지킴용 <br> 하나를 넣는다. 끝의 줄바꿈 하나는 글자로 치지 않는다
  let text = ((hasBreak ? el.innerText : el.textContent) ?? "").replace(/\r?\n$/, "");
  if (hasBreak && text === "") el.textContent = "";
  // 줄바꿈 계열 글자는 화면에서도 줄을 바꾸므로 칸 글자를 고쳐 쓴다. NBSP는 보이는 게 같아서 칸은 두고 저장할 글자만 바꾼다(고쳐 쓰면 커서가 튄다)
  if (/[\r\n\u2028\u2029]/.test(text)) {
    text = normalizeTodoText(text);
    el.textContent = text;
    caretToEnd(el);
  }
  items.value = updateText(items.value, item.id, normalizeTodoText(text));
}

/** 붙여넣은 한 줄. 다른 편집기에서 복사한 "- [x] 할 일" 줄이면 표기를 떼고 체크 상태를 살린다 */
function pastedLine(line: string): { text: string; done: boolean } {
  const [todo] = parseTodos(line.trim());
  if (todo) return { text: normalizeTodoText(todo.text).trim(), done: todo.done };
  return { text: normalizeTodoText(line).trim(), done: false };
}

// 여러 줄을 붙여넣으면 첫 줄은 지금 항목에 이어 붙이고, 나머지 줄은 각각 새 항목으로 만든다
function onItemPaste(event: ClipboardEvent, item: TodoItem) {
  const pasted = event.clipboardData?.getData("text/plain") ?? "";
  if (!/[\r\n]/.test(pasted)) return;
  event.preventDefault();
  const [first, ...lines] = pasted.split(/\r\n|[\r\n]/);
  const rest = cannotAdd.value ? [] : lines;
  const el = textOf(item.id);
  const head = parseTodos(first.trim())[0] ? pastedLine(first).text : normalizeTodoText(first);
  if (el) insertAtCaret(el, head);
  let list = updateText(items.value, item.id, normalizeTodoText(el?.textContent ?? item.text + head));
  let after = item.id;
  const created: TodoItem[] = [];
  for (const line of rest.map(pastedLine).filter((l) => !isBlankTodoText(l.text))) {
    const next = newItem(line.text, line.done);
    list = insertAfter(list, after, next);
    after = next.id;
    created.push(next);
  }
  // 정렬 설정이면 붙여넣은 끝낸 일은 끝낸 일들 맨 위로(순서 유지), 끝낸 일 사이에 들어간 남은 일은 남은 일들 끝으로 보낸다
  if (props.sortChecked) {
    const inDone = item.done;
    for (const t of created.filter((t) => !t.done && inDone)) list = settleChecked(list, t.id);
    for (const t of created.filter((t) => t.done).reverse()) list = settleChecked(list, t.id);
  }
  items.value = list;
  focusItem(after);
}

function insertAtCaret(el: HTMLElement, text: string) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (range && el.contains(range.startContainer)) {
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    el.normalize();
  } else {
    el.textContent = (el.textContent ?? "") + text;
  }
}

async function onAddKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowUp") return onArrow(event, null);
  if (event.key === "ArrowDown" && props.leaveDown) {
    event.preventDefault();
    return props.leaveDown();
  }
  // 빈 입력칸에서 Backspace는 위 할 일로 올라간다. 위 할 일의 글자는 지우지 않는다
  if (event.key === "Backspace" && draft.value === "" && items.value.length) {
    event.preventDefault();
    return focusItem(items.value[items.value.length - 1].id);
  }
  if (isEnter(event) && !isPlainEnter(event)) return event.preventDefault();
  if (!isPlainEnter(event)) return;
  if (!commitDraft()) return;
  await nextTick();
  reveal(addRow.value);
}

/**
 * 할 일을 넣는다(여럿이면 차례대로). 이 목록에 적을 수 없거나 넣을 글이 없으면 false.
 * 여럿은 한 번에 넣어야 한다 — 같은 틱에 두 번 부르면 v-model 값이 아직 그대로라 앞의 것을 덮는다
 */
function add(...raws: string[]): boolean {
  const texts = raws.map((raw) => normalizeTodoText(raw).trim()).filter((text) => !isBlankTodoText(text));
  if (!texts.length || cannotAdd.value) return false;
  let list = items.value;
  for (const created of texts.map((text) => newItem(text))) {
    list = props.sortChecked ? insertAfterOpen(list, created) : insertAfter(list, null, created);
  }
  items.value = list;
  return true;
}

/**
 * 넘길 글을 넣는다. 안 끝낸 똑같은 할 일이 이미 있으면 건너뛴다 — 빠른 입력(prependTodoIfNew)과 같은 규칙이고,
 * 종료 직전 dropOrphan이 디스크에 남지 않아 같은 글을 다시 넣는 경우도 막는다(QA12 B1). 이 목록이 받을 수 있었으면 true
 */
function addNew(...raws: string[]): boolean {
  if (cannotAdd.value) return false;
  const open = new Set(items.value.filter((item) => !item.done).map((item) => item.text.trim()));
  add(...raws.map((raw) => normalizeTodoText(raw).trim()).filter((text) => !open.has(text) && !!open.add(text)));
  return true;
}

/** 입력칸에 쓰다 만 글을 할 일로 등록한다. Cmd+S나 종료 때 입력 중이던 글을 잃지 않으려고 밖에서도 부른다 */
function commitDraft(): boolean {
  if (!add(draft.value)) return false;
  draft.value = "";
  return true;
}

/** 입력칸 글을 꺼내고 비운다(넣지 못한 글을 다른 곳에 맡길 때) */
function takeDraft(): string {
  const text = draft.value;
  draft.value = "";
  return text;
}

// 위 목록에서 내려오면 첫 할 일로, 아래 목록에서 올라오면 입력칸으로. 막힌 목록은 입력칸이 없으니 할 일로 간다
function enterFromAbove() {
  if (items.value.length) return focusItem(items.value[0].id);
  focusAddInput();
}
function enterFromBelow() {
  if (!cannotAdd.value) return focusAddInput();
  if (items.value.length) focusItem(items.value[items.value.length - 1].id);
}

defineExpose({ commitDraft, add, addNew, takeDraft, enterFromAbove, enterFromBelow });

function onItemKeydown(event: KeyboardEvent, item: TodoItem) {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    onArrow(event, item);
  } else if (isPlainEnter(event)) {
    event.preventDefault();
    if (!cannotAdd.value) splitItem(event.target as HTMLElement, item);
  } else if (isEnter(event)) {
    // Cmd+Enter(윈도 Ctrl+Enter)는 다른 할 일 앱처럼 지금 할 일의 완료를 바꾼다. Alt+Enter는 아무것도 하지 않는다
    event.preventDefault();
    if ((event.metaKey || event.ctrlKey) && !event.altKey) onToggle(item);
  } else if (event.key === "Backspace" && item.text !== "") {
    const el = event.target as HTMLElement;
    const sel = selectionIn(el);
    if (!sel || sel.start !== 0 || sel.end !== 0) return;
    // 눈에 빈 할 일을 합치면 위 할 일 끝에 띄어쓰기와 보이지 않는 글자만 붙는다. 빈 할 일을 지운 것과 같게 한다
    if (!isBlankTodoText(item.text)) return mergeIntoPrevious(event, item);
    event.preventDefault();
    removeEmpty(item);
  } else if (event.key === "Backspace" && item.text === "") {
    event.preventDefault();
    removeEmpty(item);
  }
}

// 하위 줄은 화면에 안 보여서 빈 줄 하나를 지운다고 생각하고 누른다. 하위 줄은 위 할 일 밑으로 옮기고,
// 위 할 일이 없으면 옮길 곳이 없으니 지우지 않는다
function removeEmpty(item: TodoItem) {
  const index = items.value.findIndex((t) => t.id === item.id);
  const previous = items.value[index - 1];
  if (item.children?.length && !previous) return;
  // 사용자 줄을 AI 할 일 밑으로 옮기면 그 할 일은 사용자 것이 된다. AI 되돌리기로 함께 지워지면 안 된다
  items.value = remove(items.value, item.id).map((t) =>
    t.id === previous?.id && item.children?.length
      ? { ...withoutAi(t), children: [...(t.children ?? []), ...item.children] }
      : t,
  );
  if (previous) focusItem(previous.id);
  else addRow.value?.querySelector("input")?.focus();
}

// 노션·Obsidian처럼 커서 위치에서 할 일을 둘로 나눈다. 커서 뒤 글자는 아래 새 할 일(체크 안 됨)로 내려간다
function splitItem(el: HTMLElement, item: TodoItem) {
  const text = el.textContent ?? "";
  const sel = selectionIn(el) ?? { start: text.length, end: text.length };
  const index = items.value.findIndex((t) => t.id === item.id);
  if (sel.start === 0 && sel.end === 0 && text !== "") {
    // 맨 앞에서 누르면 위에 빈 할 일을 끼우고 커서는 원래 할 일에 둔다
    items.value = [...items.value.slice(0, index), newItem(""), ...items.value.slice(index)];
    focusItem(item.id, 0);
    return;
  }
  const before = normalizeTodoText(text.slice(0, sel.start)).trimEnd();
  const after = normalizeTodoText(text.slice(sel.end)).trimStart();
  // 커서 뒤가 보이지 않는 글자뿐이면 빈 새 할 일로 만든다(그 글자만 든 할 일이 파일에 남지 않게)
  const created = newItem(isBlankTodoText(after) ? "" : after);
  items.value = insertAfter(updateText(items.value, item.id, before), item.id, created);
  focusItem(created.id, 0);
}

// 맨 앞에서 Backspace를 누르면 위 할 일 끝에 이어 붙인다. 나눌 때 뺀 띄어쓰기를 한 칸 되살린다
function mergeIntoPrevious(event: KeyboardEvent, item: TodoItem) {
  const index = items.value.findIndex((t) => t.id === item.id);
  const previous = items.value[index - 1];
  if (!previous) return;
  event.preventDefault();
  // 끝낸 일과 남은 일을 합치면 한쪽 상태가 사라진다. 상태가 다르면 합치지 않는다
  if (previous.done !== item.done) return;
  // 보이지 않는 글자뿐인 위 할 일은 눈에 빈 칸이므로 빈 칸과 같이 다룬다
  const joint = isBlankTodoText(previous.text) ? "" : /\s$/.test(previous.text) ? previous.text : `${previous.text} `;
  const children = [...(previous.children ?? []), ...(item.children ?? [])];
  // 합친 할 일에는 사용자 글이 들어 있다. AI 표시를 남기면 AI 되돌리기가 사용자 글까지 지운다
  const merged: TodoItem = { ...withoutAi(previous), text: joint + item.text, ...(children.length ? { children } : {}) };
  items.value = remove(items.value, item.id).map((t) => (t.id === previous.id ? merged : t));
  focusItem(previous.id, joint.length);
}

// 체크하고 바로 옮기면 잘못 눌렀을 때 할 일이 눈앞에서 사라진다. 0.5초 기다렸다 옮기고, 그 사이 다시 누르면 취소한다
const SETTLE_DELAY_MS = 500;
const settling = new Map<string, ReturnType<typeof setTimeout>>();

const isBlank = (item: TodoItem) => isBlankTodoText(item.text) && !item.children?.length;

function onToggle(item: TodoItem) {
  // 빈 할 일은 파일에 쓰지 않으므로 체크해도 남지 않는다. 화면에만 체크된 빈 칸이 생기지 않게 한다
  if (isBlank(item)) return;
  items.value = toggle(items.value, item.id);
  if (!props.sortChecked) return;
  const pending = settling.get(item.id);
  if (pending) {
    clearTimeout(pending);
    settling.delete(item.id);
    return;
  }
  settling.set(
    item.id,
    setTimeout(() => {
      settling.delete(item.id);
      void animateReorder(() => (items.value = settleChecked(items.value, item.id)));
    }, SETTLE_DELAY_MS),
  );
}

onBeforeUnmount(() => settling.forEach(clearTimeout));

// 순서가 바뀐 항목들이 새 자리로 미끄러져 가게 한다(바뀌기 전후 위치 차이만큼 되돌렸다가 풀어 준다).
// 위치를 모두 읽은 뒤에 애니메이션을 한꺼번에 건다. 읽기와 걸기를 번갈아 하면 WebKit이 행마다 레이아웃을
// 다시 계산해 항목 수의 제곱으로 느려진다(1,000개에 6초). 화면 밖에서 화면 밖으로 가는 행은 보이지 않으니 건너뛴다
async function animateReorder(change: () => void) {
  // 줄이 옮겨지면 브라우저가 그 줄의 포커스를 놓는다. 키보드로 체크한 사람이 이어서 칠 수 있게 같은 칸에 되돌린다
  const active = document.activeElement instanceof HTMLElement && root.value?.contains(document.activeElement)
    ? document.activeElement
    : null;
  const caret = active?.classList.contains("text") ? selectionIn(active) : null;
  const restoreFocus = () => {
    if (!active || !active.isConnected || document.activeElement === active) return;
    active.focus({ preventScroll: true });
    if (caret) caretAt(active, caret.start);
  };
  const rows = () => [...(root.value?.querySelectorAll<HTMLElement>(".item[data-item-id]") ?? [])];
  if (matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    change();
    await nextTick();
    return restoreFocus();
  }
  const before = new Map(rows().map((el) => [el.dataset.itemId, el.getBoundingClientRect().top]));
  change();
  await nextTick();
  const height = window.innerHeight;
  const moves: [HTMLElement, number][] = [];
  for (const el of rows()) {
    const from = before.get(el.dataset.itemId);
    if (from === undefined) continue;
    const rect = el.getBoundingClientRect();
    const onScreen = (top: number) => top + rect.height > 0 && top < height;
    const dy = from - rect.top;
    if (dy && (onScreen(from) || onScreen(rect.top))) moves.push([el, dy]);
  }
  restoreFocus();
  for (const [el, dy] of moves) {
    el.animate?.([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 280, easing: "ease" });
  }
}

// 입력 중인 칸에 글자를 다시 넣으면 커서가 맨 앞으로 튄다. 실제로 다를 때만 덮어쓴다
const vEditableText: Directive<HTMLElement, string> = {
  mounted(el, { value }) {
    el.textContent = value;
  },
  updated(el, { value }) {
    // WebKit이 넣은 NBSP는 저장할 때 공백으로 바뀌므로 같은 글자로 본다
    if (normalizeTodoText(el.textContent ?? "") !== value) el.textContent = value;
  },
};
</script>

<template>
  <div ref="root" class="list" :data-list="listKey">
    <div
      v-for="item in items"
      :key="item.id"
      class="item"
      :data-item-id="item.id"
      :class="{
        done: item.done,
        dragging: item.id === draggingId,
        'drop-before': isDropBefore(item.id),
      }"
    >
      <span class="grip" title="끌어서 이동" @pointerdown="emit('drag-start', item.id, $event)"
        >⋮⋮</span
      >
      <span
        class="box"
        role="checkbox"
        tabindex="0"
        :aria-checked="item.done ? 'true' : 'false'"
        :aria-label="item.text"
        @click="onToggle(item)"
        @keydown.space.prevent="onToggle(item)"
        @keydown.enter.prevent="onToggle(item)"
      ></span>
      <span
        v-editable-text="item.text"
        class="text"
        :data-id="item.id"
        contenteditable="plaintext-only"
        spellcheck="false"
        @beforeinput="onItemBeforeInput($event as InputEvent)"
        @input="onItemInput($event, item)"
        @paste="onItemPaste($event, item)"
        @keydown="onItemKeydown($event, item)"
      ></span>
      <span
        v-if="item.from"
        class="from"
        title="눌러서 표시 지우기"
        @click="items = clearFrom(items, item.id)"
        >{{ fromTagLabel(item.from) }}</span
      >
      <span v-if="item.ai" class="ai" :title="aiTagTitle(item.ai)" @click="items = acceptAi(items, item.id)"
        >AI</span
      >
    </div>
    <div v-if="blocked" ref="addRow" class="add locked" :class="{ 'drop-before': isDropBefore(null) }">
      <span class="msg">{{ blocked }}</span>
    </div>
    <div v-else ref="addRow" class="add" :class="{ 'drop-before': isDropBefore(null) }">
      <span class="box ghost"></span>
      <input v-model="draft" :placeholder="placeholder" @keydown="onAddKeydown" />
    </div>
  </div>
</template>

<style scoped>
.list {
  padding: 0 6px 6px;
}
.item,
.add {
  display: flex;
  gap: 7px;
  align-items: flex-start;
  padding: 5px 6px 5px 2px;
  border-radius: 6px;
}
.add {
  align-items: center;
  /* 손잡이 자리(14px + 간격)만큼 들여서 체크박스 열을 맞춘다 */
  padding-left: 23px;
}
.item:hover {
  background: rgba(255, 255, 255, 0.05);
}
.item.dragging {
  opacity: 0.35;
}
.drop-before {
  box-shadow: inset 0 2px 0 var(--accent);
}
.grip {
  flex: none;
  width: 14px;
  text-align: center;
  color: var(--muted);
  font-size: 11px;
  line-height: 20px;
  letter-spacing: -2px;
  opacity: 0;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.item:hover .grip {
  opacity: 1;
}
.box {
  flex: none;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  border: 1.5px solid #77777d;
  border-radius: 4px;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.box:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.box.ghost {
  margin-top: 0;
  border-style: dashed;
  cursor: default;
}
.item.done .box {
  background: var(--accent);
  border-color: var(--accent);
}
.item.done .box::after {
  content: "";
  width: 8px;
  height: 4px;
  border-left: 2px solid #fff;
  border-bottom: 2px solid #fff;
  transform: rotate(-45deg) translateY(-1px);
}
.text {
  flex: 1;
  min-width: 0;
  outline: 0;
  cursor: text;
  word-break: break-word;
}
.text:focus {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
}
.item.done .text {
  color: #77777d;
  text-decoration: line-through;
}
.from {
  flex: none;
  align-self: center;
  font-size: 10.5px;
  color: #ff9f0a;
  background: rgba(255, 159, 10, 0.14);
  border-radius: 4px;
  padding: 0 6px;
  cursor: pointer;
  white-space: nowrap;
}
.from:hover {
  background: rgba(255, 159, 10, 0.28);
}
.from:hover::after {
  content: " ✕";
}
.ai {
  flex: none;
  align-self: center;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--accent);
  background: rgba(10, 132, 255, 0.16);
  border-radius: 4px;
  padding: 0 6px;
  cursor: pointer;
}
.ai:hover {
  background: rgba(10, 132, 255, 0.3);
}
.ai:hover::after {
  content: " ✓";
}
.add.locked {
  gap: 8px;
  padding-left: 30px;
  color: var(--muted);
  font-size: 12px;
}
.add input {
  flex: 1;
  background: none;
  border: 0;
  outline: 0;
  color: var(--ink);
  font: inherit;
}
.add input::placeholder {
  color: #6f6f75;
}
</style>
