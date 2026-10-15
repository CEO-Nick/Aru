<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, type Directive } from "vue";
import type { DropMarker } from "../composables/useListDrag";
import { aiTagTitle, fromTagLabel } from "../core/format";
import {
  clearFrom,
  acceptAi,
  insertAfter,
  insertAfterOpen,
  remove,
  settleChecked,
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
}>();
const emit = defineEmits<{ "drag-start": [id: string, event: PointerEvent] }>();

function isDropBefore(id: string | null) {
  return !!props.marker && props.marker.listKey === props.listKey && props.marker.beforeId === id;
}

const draft = ref("");
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

function newItem(text: string): TodoItem {
  return { id: crypto.randomUUID(), text, done: false };
}

// 한글 조합을 확정하는 Enter와 실제 Enter가 따로 온다. 앞의 것을 무시해야 두 번 추가되지 않는다
function isPlainEnter(event: KeyboardEvent) {
  return event.key === "Enter" && !event.isComposing && event.keyCode !== 229;
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
    if ((el && !caretOnEdgeLine(el, "first")) || index === 0) return;
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
  if (/[\r\n]/.test(text)) {
    text = text.replace(/\r?\n/g, " ");
    el.textContent = text;
    caretToEnd(el);
  }
  items.value = updateText(items.value, item.id, text);
}

// 여러 줄을 붙여넣으면 첫 줄은 지금 항목에 이어 붙이고, 나머지 줄은 각각 새 항목으로 만든다
function onItemPaste(event: ClipboardEvent, item: TodoItem) {
  const pasted = event.clipboardData?.getData("text/plain") ?? "";
  if (!/[\r\n]/.test(pasted)) return;
  event.preventDefault();
  const [first, ...rest] = pasted.split(/\r?\n/);
  const el = textOf(item.id);
  if (el) insertAtCaret(el, first);
  let list = updateText(items.value, item.id, el?.textContent ?? item.text + first);
  let after = item.id;
  for (const line of rest.map((l) => l.trim()).filter(Boolean)) {
    const created = newItem(line);
    list = insertAfter(list, after, created);
    after = created.id;
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
  // 빈 입력칸에서 Backspace는 위 할 일로 올라간다. 위 할 일의 글자는 지우지 않는다
  if (event.key === "Backspace" && draft.value === "" && items.value.length) {
    event.preventDefault();
    return focusItem(items.value[items.value.length - 1].id);
  }
  if (!isPlainEnter(event)) return;
  if (!commitDraft()) return;
  await nextTick();
  reveal(addRow.value);
}

/** 입력칸에 쓰다 만 글을 할 일로 등록한다. Cmd+S나 종료 때 입력 중이던 글을 잃지 않으려고 밖에서도 부른다 */
function commitDraft(): boolean {
  const text = draft.value.trim();
  if (!text) return false;
  const created = newItem(text);
  items.value = props.sortChecked ? insertAfterOpen(items.value, created) : insertAfter(items.value, null, created);
  draft.value = "";
  return true;
}

defineExpose({ commitDraft });

function onItemKeydown(event: KeyboardEvent, item: TodoItem) {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    onArrow(event, item);
  } else if (isPlainEnter(event)) {
    event.preventDefault();
    splitItem(event.target as HTMLElement, item);
  } else if (event.key === "Backspace" && item.text !== "") {
    const el = event.target as HTMLElement;
    const sel = selectionIn(el);
    if (sel && sel.start === 0 && sel.end === 0) mergeIntoPrevious(event, item);
  } else if (event.key === "Backspace" && item.text === "") {
    event.preventDefault();
    const index = items.value.findIndex((t) => t.id === item.id);
    const previous = items.value[index - 1];
    items.value = remove(items.value, item.id);
    if (previous) focusItem(previous.id);
    else addRow.value?.querySelector("input")?.focus();
  }
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
  const before = text.slice(0, sel.start).trimEnd();
  const after = text.slice(sel.end).trimStart();
  const created = newItem(after);
  items.value = insertAfter(updateText(items.value, item.id, before), item.id, created);
  focusItem(created.id, 0);
}

// 맨 앞에서 Backspace를 누르면 위 할 일 끝에 이어 붙인다. 나눌 때 뺀 띄어쓰기를 한 칸 되살린다
function mergeIntoPrevious(event: KeyboardEvent, item: TodoItem) {
  const index = items.value.findIndex((t) => t.id === item.id);
  const previous = items.value[index - 1];
  if (!previous) return;
  event.preventDefault();
  const joint = previous.text === "" || /\s$/.test(previous.text) ? previous.text : `${previous.text} `;
  const children = [...(previous.children ?? []), ...(item.children ?? [])];
  const merged: TodoItem = { ...previous, text: joint + item.text, ...(children.length ? { children } : {}) };
  items.value = remove(items.value, item.id).map((t) => (t.id === previous.id ? merged : t));
  focusItem(previous.id, joint.length);
}

// 체크하고 바로 옮기면 잘못 눌렀을 때 할 일이 눈앞에서 사라진다. 0.5초 기다렸다 옮기고, 그 사이 다시 누르면 취소한다
const SETTLE_DELAY_MS = 500;
const settling = new Map<string, ReturnType<typeof setTimeout>>();

function onToggle(item: TodoItem) {
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

// 순서가 바뀐 항목들이 새 자리로 미끄러져 가게 한다(바뀌기 전후 위치 차이만큼 되돌렸다가 풀어 준다)
async function animateReorder(change: () => void) {
  const rows = () => [...(root.value?.querySelectorAll<HTMLElement>(".item[data-item-id]") ?? [])];
  const before = new Map(rows().map((el) => [el.dataset.itemId, el.getBoundingClientRect().top]));
  change();
  await nextTick();
  if (matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of rows()) {
    const from = before.get(el.dataset.itemId);
    const dy = from === undefined ? 0 : from - el.getBoundingClientRect().top;
    if (dy) el.animate?.([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 280, easing: "ease" });
  }
}

// 입력 중인 칸에 글자를 다시 넣으면 커서가 맨 앞으로 튄다. 실제로 다를 때만 덮어쓴다
const vEditableText: Directive<HTMLElement, string> = {
  mounted(el, { value }) {
    el.textContent = value;
  },
  updated(el, { value }) {
    if (el.textContent !== value) el.textContent = value;
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
      <span class="box" @click="onToggle(item)"></span>
      <span
        v-editable-text="item.text"
        class="text"
        :data-id="item.id"
        contenteditable="plaintext-only"
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
    <div ref="addRow" class="add" :class="{ 'drop-before': isDropBefore(null) }">
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
