<script setup lang="ts">
import { computed, ref } from "vue";
import { useLicense } from "../composables/useLicense";
import { openBuyPage } from "../platform/license";

const { status, activate } = useLicense();
const key = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

const stateText = computed(() => {
  const s = status.value;
  if (s.state === "licensed") return `등록됨 · ${s.name}`;
  if (s.state === "grandfathered") return "초기 사용자 · 계속 무료";
  if (s.state === "trial") return `체험 ${s.daysLeft}일 남음`;
  if (s.state === "expired") return "체험이 끝났어요";
  return "";
});
const needsKey = computed(() => status.value.state === "trial" || status.value.state === "expired");

async function submit() {
  if (!key.value.trim() || busy.value) return;
  busy.value = true;
  error.value = await activate(key.value);
  busy.value = false;
  if (!error.value) key.value = "";
}
</script>

<template>
  <div v-if="status.state !== 'disabled'" class="license">
    <div class="row">
      <span class="state">{{ stateText }}</span>
      <button v-if="needsKey" class="link" data-action="buy" @click="openBuyPage()">구매하기</button>
    </div>
    <form v-if="needsKey" class="row" @submit.prevent="submit">
      <input v-model="key" placeholder="라이선스 키 붙여넣기" spellcheck="false" aria-label="라이선스 키" />
      <button class="btn" data-action="activate" type="submit" :disabled="busy">등록</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.license {
  margin: 0 14px 10px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.state {
  color: var(--ink);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
input {
  flex: 1;
  min-width: 0;
  background: #1c1c1e;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--ink);
  font: 11.5px "SF Mono", Menlo, monospace;
  padding: 4px 7px;
  outline: 0;
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
.link {
  flex: none;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.error {
  margin: 0;
  color: #ff6b6b;
  font-size: 11.5px;
}
</style>
