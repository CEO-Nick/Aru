<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { nextTick, onMounted, ref } from "vue";
import { dayPath } from "./composables/useRollover";
import { toIsoDate } from "./core/date";
import { prependTodo } from "./core/todoFile";
import { tauriStore } from "./platform/tauriStore";

type Target = "today" | "someday";

const draft = ref("");
const target = ref<Target>("today");
const input = ref<HTMLInputElement>();
const added = ref(false);
let busy = false;

const close = () => invoke("hide_quick");

function reset() {
  draft.value = "";
  target.value = "today";
  added.value = false;
  busy = false;
  nextTick(() => input.value?.focus());
}

async function submit() {
  const text = draft.value.trim();
  if (busy) return;
  if (!text) return close();
  busy = true;
  const path = target.value === "today" ? dayPath(toIsoDate(new Date())) : "someday.md";
  await tauriStore.write(path, prependTodo((await tauriStore.read(path)) ?? "", text));
  added.value = true;
  setTimeout(close, 260);
}

// 한글 조합을 확정하는 Enter는 무시한다(할 일 목록과 같은 규칙)
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    void close();
  } else if (event.key === "Tab") {
    event.preventDefault();
    target.value = target.value === "today" ? "someday" : "today";
  } else if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    void submit();
  }
}

onMounted(async () => {
  document.documentElement.classList.add("quick-root");
  reset();
  await listen("quick-shown", reset);
  // Spotlight처럼 다른 곳을 누르면 닫는다
  window.addEventListener("blur", () => {
    if (!busy) void close();
  });
});
</script>

<template>
  <div class="quick" :class="{ added }">
    <svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" />
      <path v-if="added" d="M4.6 8.2l2.3 2.3 4.6-5" />
    </svg>
    <input
      ref="input"
      v-model="draft"
      :placeholder="target === 'today' ? '오늘 할 일 추가' : '언젠가 할 일 추가'"
      aria-label="빠른 할 일 입력"
      spellcheck="false"
      @keydown="onKeydown"
    />
    <button class="target" type="button" :class="target" title="Tab으로 바꾸기" @mousedown.prevent @click="target = target === 'today' ? 'someday' : 'today'">
      {{ target === "today" ? "오늘" : "언젠가" }}
    </button>
    <span class="hint">{{ added ? "추가됨" : "Enter" }}</span>
  </div>
</template>

<style>
.quick-root,
.quick-root body,
.quick-root #app {
  background: transparent !important;
}
/* 어두운 색 구성을 쓰면 브라우저가 바탕을 어둡게 칠해 둥근 막대 바깥이 비치지 않는다 */
html.quick-root {
  color-scheme: normal !important;
}
</style>

<style scoped>
.quick {
  margin: 14px 16px;
  height: 60px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px 0 18px;
  border-radius: 14px;
  background: rgba(38, 38, 40, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
  transition: border-color 0.2s ease;
}
.quick.added {
  border-color: rgba(48, 209, 88, 0.6);
}
.mark {
  flex: none;
  width: 20px;
  height: 20px;
  fill: none;
  stroke: #8e8e93;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.added .mark {
  stroke: #30d158;
}
input {
  flex: 1;
  min-width: 0;
  background: none;
  border: 0;
  outline: 0;
  color: var(--ink);
  font: 400 20px/1 -apple-system, "Apple SD Gothic Neo", sans-serif;
  letter-spacing: -0.01em;
}
input::placeholder {
  color: #6f6f75;
}
.target {
  flex: none;
  border: 0;
  border-radius: 6px;
  padding: 4px 9px;
  font: 600 12px -apple-system, "Apple SD Gothic Neo", sans-serif;
  cursor: pointer;
}
.target.today {
  background: rgba(10, 132, 255, 0.22);
  color: #6cb4ff;
}
.target.someday {
  background: rgba(255, 159, 10, 0.2);
  color: #ffb340;
}
.hint {
  flex: none;
  font: 500 11px "SF Mono", Menlo, monospace;
  color: #6f6f75;
  min-width: 38px;
  text-align: right;
}
.added .hint {
  color: #30d158;
}
</style>
