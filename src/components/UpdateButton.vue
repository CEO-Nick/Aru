<script setup lang="ts">
import { onMounted, ref } from "vue";
import { installUpdate, onUpdateAvailable, pendingUpdate } from "../platform/updater";

const version = ref<string | null>(null);
const state = ref<"idle" | "installing" | "failed">("idle");

onMounted(async () => {
  onUpdateAvailable((v) => (version.value = v));
  version.value = (await pendingUpdate()) ?? version.value;
});

async function install() {
  if (state.value === "installing") return;
  state.value = "installing";
  try {
    await installUpdate();
  } catch {
    state.value = "failed";
  }
}
</script>

<template>
  <button
    v-if="version"
    class="update"
    data-action="update"
    :disabled="state === 'installing'"
    :title="`새 버전 ${version}을 받아 설치하고 다시 켭니다`"
    @click="install"
  >
    {{ state === "installing" ? "받는 중…" : state === "failed" ? "업데이트 실패 — 다시 시도" : `${version} 업데이트` }}
  </button>
</template>

<style scoped>
.update {
  margin-left: auto;
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
