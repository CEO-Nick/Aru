<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onMounted, reactive, ref, watch, type Ref } from "vue";
import SaveStatusBar from "./components/SaveStatus.vue";
import TodoList from "./components/TodoList.vue";
import { watchDayChange } from "./composables/useDayWatcher";
import { useListDrag } from "./composables/useListDrag";
import { dayPath } from "./composables/useRollover";
import { useSettings } from "./composables/useSettings";
import { useTodoFile } from "./composables/useTodoFile";
import { useSaveIndicator } from "./composables/useSaveIndicator";
import { isRootUnavailable, reloadedForFolder, RESTORED_DRAFT, switchFolder, useStorageHealth } from "./composables/useStorageHealth";
import { AutoSaver } from "./core/autoSaver";
import { addMonths, monthGrid, monthLabel, monthSummary } from "./core/calendar";
import { inDateRange, MAX_DATE, MIN_DATE, toIsoDate } from "./core/date";
import { keptDraft, orphan } from "./core/draftStash";
import { dateLabel } from "./core/format";
import { dumpItems, parseItems } from "./core/todoFile";
import { remove, transfer } from "./core/todoList";
import type { TodoItem } from "./core/todoList";
import { onDataRootChanged } from "./platform/dataRoot";
import { updateFile } from "./platform/fileStore";
import { onFileChanged, onSelectDate, showDateInMain } from "./platform/events";
import { onQuitRequested, readyToQuit } from "./platform/lifecycle";
import { tauriStore } from "./platform/tauriStore";

const MAX_IN_CELL = 3;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const health = useStorageHealth();
const store = health.guard(tauriStore);
const saver = new AutoSaver(store);
const dayList = ref<InstanceType<typeof TodoList>>();
const somedayList = ref<InstanceType<typeof TodoList>>();
function commitDrafts() {
  dayList.value?.commitDraft();
  somedayList.value?.commitDraft();
}
const { status: saveStatus, savedAt, saveNow } = useSaveIndicator(saver, commitDrafts);

// 설정은 작은 창이 바꾼다. 여기서는 읽기만 하고 바뀌면 다시 읽는다
const {
  settings,
  load: loadSettings,
  recover: recoverSettings,
  error: settingsError,
} = useSettings(store, saver);

const today = ref(toIsoDate(new Date()));
// 작은 창이 보던 날짜를 #overview?date=YYYY-MM-DD 로 넘겨준다
const initialDate = new URLSearchParams(location.hash.split("?")[1] ?? "").get("date");
const selected = ref(initialDate && inDateRange(initialDate) ? initialDate : today.value);
const month = ref(selected.value.slice(0, 7));
const grid = computed(() => monthGrid(month.value));
const itemsByDate = reactive<Record<string, TodoItem[]>>({});
/** 이번 달 칸 중 읽지 못한 날짜 */
const unreadableDays = reactive(new Set<string>());
const summary = computed(() => monthSummary(month.value, itemsByDate));

const selectedFile = useTodoFile(
  computed(() => dayPath(selected.value)),
  store,
  saver,
);

// 한 날짜를 못 읽어도 나머지 칸은 채운다
async function readDay(date: string) {
  try {
    const content = await store.read(dayPath(date));
    itemsByDate[date] = parseItems(content ?? "", () => crypto.randomUUID()).items;
    unreadableDays.delete(date);
  } catch (e) {
    if (!isRootUnavailable(e)) unreadableDays.add(date);
  }
}

// 고른 날짜 칸은 오른쪽 목록(저장 전 내용 포함)이 맡는다
async function loadMonth() {
  await Promise.all(grid.value.filter((date) => date !== selected.value).map(readDay));
}

watch(month, () => void loadMonth());
// 입력칸에 쓰다 만 글은 떠나는 날에 넣는다. 읽는 동안에는 입력칸이 없어 그대로 두면 그사이 종료할 때 잃는다
// 떠나는 날이 막혀(읽는 중) 넣지 못한 글은 다음 날로 따라가게 두지 않고 넘길 글로 맡긴다 — 작은 창이 언젠가에 넣는다(QA11 B2와 같은 규칙)
watch(selected, (_, old) => {
  const list = dayList.value;
  if (list && !list.commitDraft()) orphan("overview.day", [list.takeDraft()]);
  // 곧 load가 목록을 비워 아래 감시는 떠나는 날 칸을 고치지 못한다. 방금 넣은 글이 칸에 보이게 여기서 넣는다
  if (selectedFile.loaded.value && !selectedFile.error.value) itemsByDate[old] = selectedFile.items.value;
  void selectedFile.load(() => saver.flush(dayPath(old)));
});
// 오른쪽에서 고친 내용을 달력 칸에 바로 반영한다. 다른 날을 눌러 아직 이전 목록이 떠 있는 동안에는 새 날 칸에 넣지 않는다
watch(selectedFile.items, (items) => {
  if (selectedFile.openList()) itemsByDate[selected.value] = items;
});

const somedayFile = useTodoFile(ref("someday.md"), store, saver);

// 언젠가 항목이나 고른 날짜의 항목을 달력의 다른 날짜 칸에 놓으면 그 날짜로 옮긴다
async function dropToDate(sourceKey: string, id: string, date: string) {
  const source = sourceKey === "someday" ? somedayFile.items : selectedFile.items;
  const item = source.value.find((t) => t.id === id);
  if (!item || !inDateRange(date)) return;
  if (date === selected.value) {
    if (source !== selectedFile.items && selectedFile.openList()) {
      [source.value, selectedFile.items.value] = transfer(source.value, selectedFile.items.value, id, null);
    }
    return;
  }
  // 대상 날짜에 먼저 쓰고, 그게 된 뒤에야 원래 목록에서 뺀다. 못 읽거나 못 쓰면 아무것도 옮기지 않는다
  // 실패라고 알린 옮기기는 나중에 몰래 써지지 않는다(저장소가 붙잡아 두지 않는다). 읽고 쓰는 사이 바뀌면 다시 읽어 넣는다
  let items: TodoItem[] = [];
  try {
    await updateFile(store, dayPath(date), (content) => {
      const parsed = parseItems(content, () => crypto.randomUUID());
      items = [...parsed.items, item];
      return dumpItems(items, parsed.doc);
    });
    itemsByDate[date] = items;
  } catch (e) {
    health.notify(
      isRootUnavailable(e)
        ? "옮기지 못했어요: 저장 폴더를 열 수 없어요"
        : `옮기지 못했어요: ${Number(date.slice(5, 7))}/${Number(date.slice(8))} 파일을 읽거나 쓰지 못했어요`,
    );
    return;
  }
  source.value = remove(source.value, id);
}

const drag = useListDrag(
  { overview: selectedFile.items, someday: somedayFile.items },
  {
    onDropToDate: (sourceKey, id, date) => void dropToDate(sourceKey, id, date),
    canDropTo: (key) => !!(key === "someday" ? somedayFile : selectedFile).openList(),
  },
);

const unreadable = computed(() =>
  [
    settingsError.value && "settings.json",
    selectedFile.error.value && selectedFile.path.value,
    ...[...unreadableDays].filter((d) => grid.value.includes(d) && d !== selected.value).sort().map(dayPath),
    somedayFile.error.value && somedayFile.path.value,
  ].filter((p): p is string => !!p),
);
const footAlert = computed(() => {
  if (health.notice.value) return health.notice.value;
  if (health.unavailable.value !== null) return "저장 폴더를 열 수 없어요";
  // 다른 파일 저장이 실패하면 그게 더 급하다. 저장 실패 표시를 가리지 않는다
  if (unreadable.value.length && saveStatus.value !== "error" && saveStatus.value !== "slow") {
    return `읽지 못한 파일이 있어요: ${unreadable.value.join(", ")}`;
  }
  return null;
});
const BLOCKED = "읽지 못한 파일이라 고칠 수 없어요";
// 다 읽기 전(날짜를 바꾸는 중 포함)에 적은 글은 곧 읽은 내용으로 덮여 사라지므로 받지 않는다
const lockOf = (file: { error: Ref<string | null>; loaded: Ref<boolean> }) =>
  file.error.value ? BLOCKED : file.loaded.value ? null : "불러오는 중…";

async function recoverAll() {
  await Promise.all([selectedFile.recover(), somedayFile.recover(), recoverSettings()]);
}

async function checkStorage() {
  if (!(await health.check(recoverAll))) return;
  await saver.flush();
  await loadMonth();
}

function select(date: string) {
  if (!inDateRange(date)) return;
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
  window.addEventListener("focus", () => void checkStorage());
  // 주기적으로는 지금 보고 있는 두 목록만 다시 읽는다. 달력 전체는 창을 다시 볼 때 읽는다
  setInterval(() => {
    void selectedFile.reloadIfChanged();
    void somedayFile.reloadIfChanged();
    if (settingsError.value) void recoverSettings();
  }, 15_000);
  // 저장 폴더가 다시 열렸는지는 작은 창처럼 자주 본다. 열려 있으면 아무것도 읽지 않는다
  setInterval(() => void checkStorage(), 3_000);
  await onSelectDate((date) => select(date));
  await onQuitRequested(saveNow);
  await onFileChanged(({ path }) => {
    if (path === selectedFile.path.value) void selectedFile.reloadIfChanged();
    if (path === somedayFile.path.value) void somedayFile.reloadIfChanged();
    if (path === "settings.json") void loadSettings();
    const date = path.match(/^daily\/(\d{4}-\d{2}-\d{2})\.md$/)?.[1];
    if (date && date !== selected.value && grid.value.includes(date)) void readDay(date);
  });
  await onDataRootChanged((changed) =>
    switchFolder(health, saver, [selectedFile, somedayFile], checkStorage, () => loadSettings({ adopt: true }), changed, commitDrafts),
  );
  await getCurrentWindow().onCloseRequested(async () => {
    await saveNow();
  });
  if (reloadedForFolder()) {
    // 옛 폴더의 막힌 목록에 넣지 못한 글은 새 폴더에 말없이 넣지 않는다(작은 창과 같은 규칙, 리뷰 L4)
    if (keptDraft("overview.day") || keptDraft("overview.someday")) health.notify(RESTORED_DRAFT);
    void readyToQuit(() => saver.flush());
  }
});
</script>

<template>
  <div class="overview">
    <div class="calendar">
      <div class="head">
        <button class="nav" aria-label="이전 달" :disabled="month <= MIN_DATE.slice(0, 7)" @click="month = addMonths(month, -1)">◀</button>
        <div class="month">{{ monthLabel(month) }}</div>
        <button class="nav" aria-label="다음 달" :disabled="month >= MAX_DATE.slice(0, 7)" @click="month = addMonths(month, 1)">▶</button>
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
          :blocked="lockOf(selectedFile)"
          list-key="overview"
          draft-slot="overview.day"
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
            :blocked="lockOf(somedayFile)"
            list-key="someday"
            draft-slot="overview.someday"
            placeholder="언젠가 할 일 추가"
            :marker="drag.state.marker"
            :dragging-id="drag.state.draggingId"
            @drag-start="(id, e) => drag.start('someday', id, e)"
          />
        </div>
        <div class="side-hint">⋮⋮ 끌어서 달력 칸에 놓으면 그 날짜로 옮겨진다</div>
      </div>
      <SaveStatusBar :status="saveStatus" :saved-at="savedAt" :alert="footAlert" :info="health.info.value">
        <span v-if="health.unavailable.value !== null" class="folder-actions">
          <button data-action="repick-folder" @click="health.repick(() => saver.flush())">폴더 다시 고르기</button>
          <button data-action="default-folder" @click="health.useDefault()">기본 폴더 쓰기</button>
        </span>
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
.nav:disabled {
  opacity: 0.3;
  background: none;
  cursor: default;
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
.folder-actions {
  display: flex;
  gap: 8px;
}
.folder-actions button {
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
</style>
