<script setup lang="ts">
import { computed } from "vue";
import { noteLines, useUpdate } from "../composables/useUpdate";
import UpdateButton from "./UpdateButton.vue";

const { state, check } = useUpdate();

const lines = computed(() => (state.available ? noteLines(state.available.notes) : []));

const note = computed(
  () =>
    ({
      idle: null,
      checking: null,
      latest: "최신 버전이에요",
      failed: "확인하지 못했어요. 인터넷 연결을 확인해 주세요",
    })[state.check],
);
</script>

<template>
  <div class="about">
    <div class="row">
      <span class="version">Aru {{ state.current ?? "" }}</span>
      <UpdateButton v-if="state.available" />
      <button
        v-else
        class="btn"
        data-action="check-update"
        :disabled="state.check === 'checking'"
        @click="check"
      >
        {{ state.check === "checking" ? "확인 중…" : "업데이트 확인" }}
      </button>
    </div>
    <ul v-if="lines.length" class="notes">
      <li v-for="line in lines" :key="line">{{ line }}</li>
    </ul>
    <p v-if="note" class="note">{{ note }}</p>
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
