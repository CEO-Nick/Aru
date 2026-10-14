<script setup lang="ts">
import { computed } from "vue";
import { addDays } from "../core/date";
import { dateLabel } from "../core/format";

const props = defineProps<{ date: string; today: string }>();
const emit = defineEmits<{ "update:date": [date: string]; "open-calendar": [] }>();

const tag = computed(() => {
  if (props.date < props.today) return { text: "지난 날짜", cls: "past" };
  if (props.date > props.today) return { text: "예정", cls: "future" };
  return null;
});
</script>

<template>
  <div class="datebar">
    <button class="nav" aria-label="이전 날" @click="emit('update:date', addDays(date, -1))">◀</button>
    <button class="date" title="달력 열기" @click="emit('open-calendar')">{{ dateLabel(date) }}</button>
    <span v-if="tag" class="tag" :class="tag.cls">{{ tag.text }}</span>
    <span class="spacer"></span>
    <button class="nav" aria-label="다음 날" @click="emit('update:date', addDays(date, 1))">▶</button>
    <button class="today-btn" :class="{ hot: !!tag }" @click="emit('update:date', today)">오늘</button>
  </div>
</template>

<style scoped>
.datebar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 5px;
}
button {
  font: inherit;
  border: 0;
  background: none;
  color: var(--ink);
  cursor: pointer;
  padding: 0;
}
.nav {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  color: var(--icon);
  font-size: 11px;
}
.nav:hover,
.date:hover {
  background: var(--hover);
}
.date {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  border-radius: 5px;
  padding: 1px 4px;
}
.spacer {
  flex: 1;
}
.tag {
  font-size: 11px;
  border-radius: 4px;
  padding: 1px 6px;
}
.tag.past {
  background: rgba(255, 159, 10, 0.18);
  color: #ff9f0a;
}
.tag.future {
  background: rgba(10, 132, 255, 0.2);
  color: #6cb4ff;
}
.today-btn {
  border: 1px solid var(--line);
  color: #cfcfd4;
  font-size: 11.5px;
  border-radius: 20px;
  padding: 1px 9px;
}
.today-btn.hot {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
</style>
