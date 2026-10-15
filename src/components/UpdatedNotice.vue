<script setup lang="ts">
import { useUpdate } from "../composables/useUpdate";

const { state } = useUpdate();
</script>

<template>
  <Transition name="fade">
    <span v-if="state.justUpdated" class="updated">{{ state.justUpdated }}로 업데이트됨</span>
  </Transition>
</template>

<style scoped>
.updated {
  color: var(--accent);
  font-size: 11px;
  white-space: nowrap;
}
.fade-leave-active {
  transition: opacity 0.4s ease;
}
.fade-leave-to {
  opacity: 0;
}
</style>
