<script setup lang="ts">
import { computed } from "vue";
import { noteLines, useUpdate } from "../composables/useUpdate";

const { state, install } = useUpdate();

const title = computed(() => {
  if (!state.available) return "";
  const lines = noteLines(state.available.notes).map((line) => `• ${line}`);
  return [`새 버전 ${state.available.version} — 누르면 받아 설치하고 다시 켭니다`, ...lines].join("\n");
});
</script>

<template>
  <button
    v-if="state.available"
    class="update"
    data-action="update"
    :disabled="state.install === 'installing'"
    :title="title"
    @click="install"
  >
    {{
      state.install === "installing"
        ? "받는 중…"
        : state.install === "failed"
          ? "업데이트 실패 — 다시 시도"
          : `${state.available.version} 업데이트`
    }}
  </button>
</template>

<style scoped>
.update {
  border: 0;
  border-radius: 999px;
  padding: 1px 8px;
  font: inherit;
  font-size: 11px;
  color: #fff;
  background: var(--accent);
  cursor: pointer;
  white-space: nowrap;
}
.update:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
