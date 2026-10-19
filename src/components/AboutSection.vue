<script setup lang="ts">
import { getVersion } from "@tauri-apps/api/app";
import { ref } from "vue";
import { openFeedback } from "../platform/feedback";

// 앱스토어판은 업데이트를 앱스토어가 맡아서 버전만 보여 준다
const version = ref("");
// 버전을 못 읽으면 이름만 보인다
getVersion().then(
  (v) => (version.value = v),
  () => {},
);
</script>

<template>
  <div class="about">
    <div class="row">
      <span class="version">Aru {{ version }}</span>
    </div>
    <div class="row feedback">
      <span class="hint">불편하거나 바라는 게 있나요?</span>
      <button class="btn" data-action="feedback" @click="openFeedback">의견 보내기</button>
    </div>
  </div>
</template>

<style scoped>
.about {
  margin: 0 14px 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.version {
  color: var(--muted);
  font-size: 12px;
}
.btn {
  flex: none;
  white-space: nowrap;
  border: 1px solid var(--line);
  background: #3a3a3d;
  color: var(--ink);
  border-radius: 6px;
  padding: 3px 10px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11.5px;
}
.feedback {
  margin-top: 10px;
}
.notes {
  margin: 8px 0 0;
  padding-left: 16px;
  color: var(--ink);
  font-size: 11.5px;
  line-height: 1.5;
}
.note {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 11.5px;
}
</style>
