<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SaveStatus } from "../core/autoSaver";

const props = defineProps<{ status: SaveStatus; savedAt?: number | null }>();

const label = computed(
  () =>
    ({
      saved: "저장됨",
      pending: "저장 대기 중…",
      error: "저장 실패 — 다시 시도합니다",
    })[props.status],
);

const time = computed(() => {
  if (props.status !== "saved" || !props.savedAt) return null;
  const d = new Date(props.savedAt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
});

// 저장이 끝날 때마다 잠깐 반짝여서 반영됐다는 걸 알려 준다
const flash = ref(false);
// 연달아 저장해도 애니메이션이 처음부터 다시 돌도록 점을 새로 그린다
const flashKey = ref(0);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => props.savedAt,
  (now, before) => {
    if (!now || now === before) return;
    flashKey.value++;
    flash.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => (flash.value = false), 1200);
  },
);
</script>

<template>
  <footer class="foot" :class="{ flash }">
    <span :key="flashKey" class="dot" :class="status">
      <svg v-if="status === 'saved'" viewBox="0 0 10 10" class="check">
        <path d="M2.2 5.2l1.9 1.9 3.8-4.2" />
      </svg>
    </span>
    <span class="status">{{ label }}</span>
    <span v-if="time" class="time">{{ time }}</span>
    <slot />
  </footer>
</template>

<style scoped>
.foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: #77777d;
  transition: color 0.4s ease;
  white-space: nowrap;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #30d158;
  display: grid;
  place-items: center;
  transition:
    width 0.25s ease,
    height 0.25s ease;
}
.dot.pending {
  background: #8e8e93;
  animation: breathe 1.2s ease-in-out infinite;
}
.dot.error {
  background: #ff453a;
}
.check {
  width: 0;
  height: 0;
  stroke: #fff;
  stroke-width: 1.6;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.time {
  font-variant-numeric: tabular-nums;
}
.time::before {
  content: "· ";
}
/* 저장 직후: 점이 커지며 체크 표시가 나타나고 글자가 초록으로 잠깐 바뀐다 */
.flash {
  color: #30d158;
}
.flash .dot {
  width: 12px;
  height: 12px;
  animation: pop 0.45s ease-out;
}
.flash .check {
  width: 9px;
  height: 9px;
}
@keyframes pop {
  0% {
    transform: scale(0.6);
    box-shadow: 0 0 0 0 rgba(48, 209, 88, 0.6);
  }
  60% {
    transform: scale(1.15);
    box-shadow: 0 0 0 5px rgba(48, 209, 88, 0);
  }
  100% {
    transform: scale(1);
  }
}
@keyframes breathe {
  50% {
    opacity: 0.35;
  }
}
</style>
