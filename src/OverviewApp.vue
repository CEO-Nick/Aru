<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onMounted, reactive, ref, watch } from "vue";
import SaveStatusBar from "./components/SaveStatus.vue";
import TodoList from "./components/TodoList.vue";
import { watchDayChange } from "./composables/useDayWatcher";
import { useListDrag } from "./composables/useListDrag";
import { dayPath } from "./composables/useRollover";
import { useSettings } from "./composables/useSettings";
import { useTodoFile } from "./composables/useTodoFile";
import { useSaveIndicator } from "./composables/useSaveIndicator";
import { AutoSaver } from "./core/autoSaver";
import { addMonths, monthGrid, monthLabel, monthSummary } from "./core/calendar";
import { toIsoDate } from "./core/date";
import { dateLabel } from "./core/format";
import { dumpItems, parseItems } from "./core/todoFile";
import { remove, transfer } from "./core/todoList";
import type { TodoItem } from "./core/todoList";
import { onDataRootChanged } from "./platform/dataRoot";
import { onFileChanged, onSelectDate, showDateInMain } from "./platform/events";
import { onQuitRequested } from "./platform/lifecycle";
import { tauriStore } from "./platform/tauriStore";

const MAX_IN_CELL = 3;
const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

const saver = new AutoSaver(tauriStore);
const dayList = ref<InstanceType<typeof TodoList>>();
const somedayList = ref<InstanceType<typeof TodoList>>();
function commitDrafts() {
  dayList.value?.commitDraft();
  somedayList.value?.commitDraft();
}
const { status: saveStatus, savedAt, saveNow } = useSaveIndicator(saver, commitDrafts);

// 설정은 작은 창이 바꾼다. 여기서는 읽기만 하고 바뀌면 다시 읽는다
const { settings, load: loadSettings } = useSettings(tauriStore, saver);

const today = ref(toIsoDate(new Date()));
// 작은 창이 보던 날짜를 #overview?date=YYYY-MM-DD 로 넘겨준다
const initialDate = new URLSearchParams(location.hash.split("?")[1] ?? "").get("date");
const selected = ref(initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : today.value);
const month = ref(selected.value.slice(0, 7));
const grid = computed(() => monthGrid(month.value));
const itemsByDate = reactive<Record<string, TodoItem[]>>({});
const summary = computed(() => monthSummary(month.value, itemsByDate));

const selectedFile = useTodoFile(
  computed(() => dayPath(selected.value)),
  tauriStore,
  saver,
);

async function readDay(date: string) {
  const content = await tauriStore.read(dayPath(date));
  itemsByDate[date] = parseItems(content ?? "", () => crypto.randomUUID()).items;
}

// 고른 날짜 칸은 오른쪽 목록(저장 전 내용 포함)이 맡는다
async function loadMonth() {
  await Promise.all(grid.value.filter((date) => date !== selected.value).map(readDay));
}

watch(month, () => void loadMonth());
watch(selected, async () => {
  await saver.flush();
  await selectedFile.load();
});
// 오른쪽에서 고친 내용을 달력 칸에 바로 반영한다
watch(selectedFile.items, (items) => (itemsByDate[selected.value] = items));

const somedayFile = useTodoFile(ref("someday.md"), tauriStore, saver);

// 언젠가 항목이나 고른 날짜의 항목을 달력의 다른 날짜 칸에 놓으면 그 날짜로 옮긴다
async function dropToDate(sourceKey: string, id: string, date: string) {
  const source = sourceKey === "someday" ? somedayFile.items : selectedFile.items;
  const item = source.value.find((t) => t.id === id);
  if (!item) return;
  if (date === selected.value) {
    if (source !== selectedFile.items) {
      [source.value, selectedFile.items.value] = transfer(source.value, selectedFile.items.value, id, null);
    }
    return;
  }
  source.value = remove(source.value, id);
  const path = dayPath(date);
  const doc = parseItems((await tauriStore.read(path)) ?? "", () => crypto.randomUUID());
  const items = [...doc.items, item];
  saver.schedule(path, dumpItems(items, doc.notes), "now");
  itemsByDate[date] = items;
}

const drag = useListDrag(
  { overview: selectedFile.items, someday: somedayFile.items },
  { onDropToDate: (sourceKey, id, date) => void dropToDate(sourceKey, id, date) },
);

function select(date: string) {
  selected.value = date;
  if (!date.startsWith(month.value)) month.value = date.slice(0, 7);
}

function goToday() {
  today.value = toIsoDate(new Date());
  month.value = today.value.slice(0, 7);
  selected.value = today.value;
}

function cellClass(date: string) {
  return {
    out: !date.startsWith(month.value),
    past: date < today.value,
    today: date === today.value,
    sel: date === selected.value,
    "drop-target": drag.state.marker?.date === date,
  };
}

const selectedTag = computed(() => {
  if (selected.value === today.value) return { text: "오늘", cls: "is-today" };
  return selected.value < today.value
    ? { text: "지난 날짜", cls: "past" }
    : { text: "예정", cls: "future" };
});

const selectedCounts = computed(() => {
  const items = selectedFile.items.value;
  const done = items.filter((i) => i.done).length;
  return { done, pending: items.length - done };
});

onMounted(async () => {
  await Promise.all([loadMonth(), selectedFile.load(), somedayFile.load(), loadSettings()]);
  watchDayChange(() => (today.value = toIsoDate(new Date())));
  window.addEventListener("blur", () => void saver.flush());
  // 창을 오갈 때마다 한 달 치를 읽지 않도록 2초에 한 번으로 묶는다
  let lastRefresh = 0;
  const refresh = () => {
    if (Date.now() - lastRefresh < 2000) return;
    lastRefresh = Date.now();
    void selectedFile.reloadIfChanged();
    void somedayFile.reloadIfChanged();
    void loadMonth();
  };
  window.addEventListener("focus", refresh);
  // 주기적으로는 지금 보고 있는 두 목록만 다시 읽는다. 달력 전체는 창을 다시 볼 때 읽는다
  setInterval(() => {
    void selectedFile.reloadIfChanged();
    void somedayFile.reloadIfChanged();
  }, 15_000);
  await onSelectDate((date) => select(date));
  await onQuitRequested(() => saveNow());
  await onFileChanged(({ path }) => {
    if (path === selectedFile.path.value) void selectedFile.reloadIfChanged();
    if (path === somedayFile.path.value) void somedayFile.reloadIfChanged();
    if (path === "settings.json") void loadSettings();
    const date = path.match(/^daily\/(\d{4}-\d{2}-\d{2})\.md$/)?.[1];
    if (date && date !== selected.value && grid.value.includes(date)) void readDay(date);
  });
  await onDataRootChanged(() => location.reload());
  await getCurrentWindow().onCloseRequested(async () => {
    await saveNow();
  });
});
</script>

<template>
  <div class="overview">
    <div class="calendar">
      <div class="head">
        <button class="nav" aria-label="이전 달" @click="month = addMonths(month, -1)">◀</button>
        <div class="month">{{ monthLabel(month) }}</div>
        <button class="nav" aria-label="다음 달" @click="month = addMonths(month, 1)">▶</button>
        <button class="pill" @click="goToday">오늘</button>
        <span class="summary">이번 달 완료 {{ summary.done }} · 미완료 {{ summary.pending }}</span>
      </div>
      <div class="grid">
        <div v-for="w in WEEKDAYS" :key="w" class="dow">{{ w }}</div>
        <div
          v-for="date in grid"
          :key="date"
          class="cell"
          :class="cellClass(date)"
          :data-date="date"
          :data-drop-date="date"
          @click="select(date)"
        >
          <span class="num">{{ Number(date.slice(8)) }}</span>
          <div
            v-for="item in (itemsByDate[date] ?? []).slice(0, MAX_IN_CELL)"
            :key="item.id"
            class="mi"
            :class="{ done: item.done }"
          >
            {{ item.text }}
          </div>
          <div v-if="(itemsByDate[date]?.length ?? 0) > MAX_IN_CELL" class="more">
            +{{ itemsByDate[date].length - MAX_IN_CELL }}
          </div>
        </div>
      </div>
    </div>
    <aside class="side">
      <div class="side-head">
        <span class="side-date">{{ dateLabel(selected) }}</span>
        <span class="tag" :class="selectedTag.cls">{{ selectedTag.text }}</span>
      </div>
      <div class="side-sum">
        <template v-if="selectedCounts.done + selectedCounts.pending">
          완료 {{ selectedCounts.done }} · 미완료 {{ selectedCounts.pending }}
        </template>
        <template v-else>등록된 할 일 없음</template>
      </div>
      <div class="side-list">
        <TodoList
          v-model="selectedFile.items.value"
          ref="dayList"
          :sort-checked="settings.sortChecked"
          list-key="overview"
          placeholder="이 날짜에 할 일 추가"
          :marker="drag.state.marker"
          :dragging-id="drag.state.draggingId"
          @drag-start="(id, e) => drag.start('overview', id, e)"
        />
      </div>
      <div class="side-someday">
        <div class="side-label">언젠가</div>
        <div class="side-list">
          <TodoList
            v-model="somedayFile.items.value"
            ref="somedayList"
            :sort-checked="settings.sortChecked"
          list-key="someday"
            placeholder="언젠가 할 일 추가"
            :marker="drag.state.marker"
            :dragging-id="drag.state.draggingId"
            @drag-start="(id, e) => drag.start('someday', id, e)"
          />
        </div>
        <div class="side-hint">⋮⋮ 끌어서 달력 칸에 놓으면 그 날짜로 옮겨진다</div>
      </div>
      <SaveStatusBar :status="saveStatus" :saved-at="savedAt">
        <button class="show-main" @click="showDateInMain(selected)">작은 창에서 보기</button>
      </SaveStatusBar>
    </aside>
  </div>
</template>

<style scoped>
.overview {
  display: grid;
  grid-template-columns: 1fr 300px;
  height: 100%;
}
.calendar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: auto;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
}
.month {
  font-size: 17px;
  font-weight: 600;
  min-width: 120px;
  text-align: center;
}
button {
  font: inherit;
  color: var(--ink);
  border: 0;
  background: none;
  cursor: pointer;
}
.nav {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  color: var(--icon);
  font-size: 11px;
}
.nav:hover {
  background: var(--hover);
}
.pill {
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 1px 10px;
  font-size: 12px;
  color: #cfcfd4;
}
.summary {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
}
.grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-template-rows: 28px;
  grid-auto-rows: minmax(104px, 1fr);
  border-top: 1px solid var(--line);
}
.grid .dow {
  font-size: 11.5px;
  color: var(--muted);
  padding: 6px 9px;
  border-right: 1px solid var(--line);
  height: 28px;
}
.cell {
  padding: 6px 7px;
  border-top: 1px solid var(--line);
  border-right: 1px solid var(--line);
  cursor: pointer;
  overflow: hidden;
  min-width: 0;
}
.cell:hover {
  background: rgba(255, 255, 255, 0.04);
}
.num {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #cfcfd4;
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  border-radius: 50%;
}
.cell.today .num {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.cell.sel {
  box-shadow: inset 0 0 0 2px var(--accent);
  background: rgba(10, 132, 255, 0.08);
}
.cell.past .mi,
.cell.past .num {
  opacity: 0.55;
}
.cell.out {
  background: rgba(0, 0, 0, 0.18);
}
.cell.out .num {
  opacity: 0.35;
}
.mi {
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
  padding-left: 13px;
  position: relative;
}
.mi::before {
  content: "";
  position: absolute;
  left: 1px;
  top: 5px;
  width: 7px;
  height: 7px;
  border: 1.3px solid #8e8e93;
  border-radius: 2px;
}
.mi.done {
  color: #77777d;
  text-decoration: line-through;
}
.mi.done::before {
  background: #5b5b60;
  border-color: #5b5b60;
}
.more {
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
  padding-left: 13px;
}
.side {
  border-left: 1px solid var(--line);
  background: #222224;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.side-head {
  padding: 14px 14px 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.side-date {
  font-weight: 600;
  font-size: 15px;
}
.side-sum {
  padding: 0 14px 8px;
  font-size: 12px;
  color: var(--muted);
}
.side-list {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.side-someday {
  flex: 0 0 42%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--line);
}
.side-label {
  font-size: 11.5px;
  color: var(--muted);
  padding: 8px 14px 2px;
}
.side-hint {
  font-size: 11px;
  color: #6f6f75;
  padding: 4px 14px 8px;
}
.cell.drop-target {
  box-shadow: inset 0 0 0 2px #30d158;
  background: rgba(48, 209, 88, 0.1);
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
.tag.future,
.tag.is-today {
  background: rgba(10, 132, 255, 0.2);
  color: #6cb4ff;
}
.show-main {
  margin-left: auto;
  font-size: 11px;
  color: #6cb4ff;
}
</style>
