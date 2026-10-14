<script setup lang="ts">
import { nextTick, ref, type Directive } from "vue";
import type { DropMarker } from "../composables/useListDrag";
import { fromTagLabel } from "../core/format";
import {
  clearFrom,
  insertAfter,
  remove,
  toggle,
  updateText,
  type TodoItem,
} from "../core/todoList";

const items = defineModel<TodoItem[]>({ required: true });
const props = defineProps<{
  placeholder: string;
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

async function focusItem(id: string) {
  await nextTick();
  const el = textOf(id);
  if (!el) return;
  el.focus();
  caretToEnd(el);
  reveal(el);
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

function onItemInput(event: Event, item: TodoItem) {
  const el = event.target as HTMLElement;
  let text = el.textContent ?? "";
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
  if (!isPlainEnter(event)) return;
  const text = draft.value.trim();
  if (!text) return;
  items.value = insertAfter(items.value, null, newItem(text));
  draft.value = "";
  await nextTick();
  reveal(addRow.value);
}

function onItemKeydown(event: KeyboardEvent, item: TodoItem) {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    onArrow(event, item);
  } else if (isPlainEnter(event)) {
    event.preventDefault();
    const created = newItem("");
    items.value = insertAfter(items.value, item.id, created);
    focusItem(created.id);
  } else if (event.key === "Backspace" && item.text === "") {
    event.preventDefault();
    const index = items.value.findIndex((t) => t.id === item.id);
    const previous = items.value[index - 1];
    items.value = remove(items.value, item.id);
    if (previous) focusItem(previous.id);
    else addRow.value?.querySelector("input")?.focus();
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
      <span class="box" @click="items = toggle(items, item.id)"></span>
      <span
        v-editable-text="item.text"
        class="text"
        :data-id="item.id"
        contenteditable="plaintext-only"
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
