<script setup lang="ts">
import { sliderToAlpha } from "../core/opacity";
import type { WindowControl } from "../platform/windowControl";

const props = withDefaults(
  defineProps<{ windowControl: WindowControl; opacity: number; alwaysOnTop?: boolean }>(),
  { alwaysOnTop: true },
);
const emit = defineEmits<{
  "update:opacity": [value: number];
  "update:alwaysOnTop": [value: boolean];
  "open-overview": [];
  "open-settings": [];
}>();

function onSlide(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  emit("update:opacity", value);
  props.windowControl.setOpacity(sliderToAlpha(value));
}

function togglePin() {
  const next = !props.alwaysOnTop;
  emit("update:alwaysOnTop", next);
  props.windowControl.setAlwaysOnTop(next);
}
</script>

<template>
  <header class="titlebar" data-tauri-drag-region>
    <button
      class="icon pin"
      :class="{ on: alwaysOnTop }"
      aria-label="항상 위에 고정"
      :aria-pressed="alwaysOnTop"
      :title="alwaysOnTop ? '항상 위에 고정됨 (누르면 해제)' : '고정 안 됨 (누르면 항상 위에 고정)'"
      @click="togglePin"
    >
      <svg viewBox="0 0 16 16">
        <path d="M6 1.8h4l-.6 4.4 2.3 2.3H4.3l2.3-2.3z" />
        <path d="M8 8.5v5.7" />
      </svg>
    </button>
    <button class="icon" aria-label="모아보기" title="모아보기" @click="emit('open-overview')">
      <svg viewBox="0 0 16 16">
        <rect x="2" y="3" width="12" height="11" rx="2" />
        <path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4" />
      </svg>
    </button>
    <button class="icon" aria-label="설정" title="설정" @click="emit('open-settings')">
      <svg viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="2.2" />
        <path
          d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"
        />
      </svg>
    </button>
    <input
      type="range"
      min="0"
      max="100"
      :value="opacity"
      aria-label="투명도"
      title="투명도"
      @input="onSlide"
    />
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  height: 34px;
  /* macOS 신호등 버튼이 그려지는 자리를 비워 둔다 */
  padding: 0 10px 0 76px;
  background: var(--bar);
  border-bottom: 1px solid var(--line);
  user-select: none;
  -webkit-user-select: none;
}
.icon {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--icon);
  padding: 0;
  cursor: pointer;
}
.icon:hover {
  background: var(--hover);
  color: var(--ink);
}
.pin.on {
  color: var(--accent);
}
.pin.on svg {
  fill: currentColor;
}
.pin:not(.on) svg {
  transform: rotate(35deg);
}
.icon svg {
  width: 15px;
  height: 15px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 74px;
  height: 3px;
  margin-left: 4px;
  border-radius: 2px;
  background: var(--track);
  outline: 0;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--thumb);
  cursor: pointer;
}
</style>
