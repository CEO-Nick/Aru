<script setup lang="ts">
import { computed } from "vue";
import type { SaveStatus } from "../core/autoSaver";

const props = defineProps<{ status: SaveStatus }>();

const label = computed(
  () =>
    ({
      saved: "저장됨",
      pending: "저장 대기 중…",
      error: "저장 실패 — 다시 시도합니다",
    })[props.status],
);
</script>

<template>
  <footer class="foot">
    <span class="dot" :class="status"></span>
    <span class="status">{{ label }}</span>
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
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #30d158;
}
.dot.pending {
  background: #8e8e93;
}
.dot.error {
  background: #ff453a;
}
</style>
