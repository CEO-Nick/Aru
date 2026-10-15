<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onMounted, ref, watch } from "vue";
import AboutSection from "./components/AboutSection.vue";
import DateBar from "./components/DateBar.vue";
import SaveStatusBar from "./components/SaveStatus.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import TitleBar from "./components/TitleBar.vue";
import TodoList from "./components/TodoList.vue";
import UpdateButton from "./components/UpdateButton.vue";
import UpdatedNotice from "./components/UpdatedNotice.vue";
import { watchDayChange } from "./composables/useDayWatcher";
import { useAiNotice } from "./composables/useAiNotice";
import { useListDrag } from "./composables/useListDrag";
import { dayPath, rollover } from "./composables/useRollover";
import { useSettings } from "./composables/useSettings";
import { useTodoFile } from "./composables/useTodoFile";
import { useSaveIndicator } from "./composables/useSaveIndicator";
import { AutoSaver } from "./core/autoSaver";
import { toIsoDate } from "./core/date";
import { splitRatio } from "./core/layout";
import { sliderToAlpha } from "./core/opacity";
import { getDataRoot, onDataRootChanged, pickDataRoot, revealDataRoot } from "./platform/dataRoot";
import { toolLabel } from "./core/format";
import { onFileChanged, onShowDate, openOverview } from "./platform/events";
import { onQuitRequested } from "./platform/lifecycle";
import { tauriStore } from "./platform/tauriStore";
import { tauriWindow } from "./platform/tauriWindow";

const saver = new AutoSaver(tauriStore);
const todayList = ref<InstanceType<typeof TodoList>>();
const somedayList = ref<InstanceType<typeof TodoList>>();
function commitDrafts() {
  todayList.value?.commitDraft();
  somedayList.value?.commitDraft();
}
const { status: saveStatus, savedAt, saveNow } = useSaveIndicator(saver, commitDrafts);

const { settings, load: loadSettings } = useSettings(tauriStore, saver);

/** 실제 오늘 */
const today = ref(toIsoDate(new Date()));
/** 위쪽 목록이 보여주는 날짜. ◀ ▶ 로 바뀐다 */
const viewDate = ref(today.value);
const dayFile = useTodoFile(
  computed(() => dayPath(viewDate.value)),
  tauriStore,
  saver,
);
const somedayFile = useTodoFile(ref("someday.md"), tauriStore, saver);
const todayItems = dayFile.items;
const somedayItems = somedayFile.items;

watch(viewDate, async () => {
  await saver.flush();
  await dayFile.load();
});

let checking = false;
async function checkDayChange() {
  const now = toIsoDate(new Date());
  if (now === today.value || checking) return;
  checking = true;
  try {
    const previous = today.value;
    const wasViewingToday = viewDate.value === previous;
    await rollover(now, settings, tauriStore, saver, somedayItems, previous);
    today.value = now;
    if (wasViewingToday) viewDate.value = now;
    else await dayFile.load();
  } finally {
    checking = false;
  }
}

const showSettings = ref(false);
const dataRoot = ref("");

async function openSettings() {
  showSettings.value = !showSettings.value;
  if (showSettings.value) dataRoot.value = await getDataRoot();
}

async function changeFolder() {
  await saver.flush();
  await pickDataRoot();
}

function openCalendar() {
  void openOverview(viewDate.value);
}

const drag = useListDrag({ today: todayItems, someday: somedayItems });
const aiNotice = useAiNotice([todayItems, somedayItems]);

const body = ref<HTMLElement>();

function startSplit(event: PointerEvent) {
  event.preventDefault();
  const onMove = (e: PointerEvent) => {
    const rect = body.value!.getBoundingClientRect();
    settings.value.splitRatio = splitRatio(e.clientY, rect.top, rect.height);
  };
  const onEnd = () => {
    document.body.classList.remove("resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
  };
  document.body.classList.add("resizing");
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd);
  window.addEventListener("pointercancel", onEnd);
}

// 창을 오갈 때마다 읽지 않도록 2초에 한 번으로 묶는다
let lastReload = 0;
function reloadFiles() {
  if (Date.now() - lastReload < 2000) return;
  lastReload = Date.now();
  void dayFile.reloadIfChanged();
  void somedayFile.reloadIfChanged();
}

onMounted(async () => {
  await Promise.all([loadSettings(), somedayFile.load()]);
  await rollover(today.value, settings, tauriStore, saver, somedayItems);
  await dayFile.load();
  void tauriWindow.setOpacity(sliderToAlpha(settings.value.opacity));
  if (!settings.value.alwaysOnTop) void tauriWindow.setAlwaysOnTop(false);

  window.addEventListener("blur", () => void saver.flush());
  watchDayChange(() => void checkDayChange());
  window.addEventListener("focus", reloadFiles);
  // 항상 떠 있는 창이라 클릭하지 않아도 다른 편집기에서 고친 내용이 보여야 한다
  setInterval(reloadFiles, 15_000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void saver.flush();
  });
  // 작은 창을 닫으면 앱을 끄지 않고 숨긴다. 메뉴 막대 아이콘이나 Dock 아이콘으로 다시 연다
  await getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault();
    await saveNow();
    await getCurrentWindow().hide();
  });
  await onFileChanged(({ path }) => {
    if (path === dayFile.path.value) void dayFile.reloadIfChanged();
    if (path === somedayFile.path.value) void somedayFile.reloadIfChanged();
  });
  // 저장 폴더가 바뀌면 모든 걸 새 폴더에서 다시 읽는다
  await onDataRootChanged(() => location.reload());
  await onShowDate(async (date) => {
    viewDate.value = date;
    const win = getCurrentWindow();
    await win.unminimize();
    await win.show();
    await win.setFocus();
  });
  await onQuitRequested(() => saveNow());
});
</script>

<template>
  <div class="app">
    <TitleBar
      v-model:opacity="settings.opacity"
      v-model:always-on-top="settings.alwaysOnTop"
      :window-control="tauriWindow"
      @open-overview="openCalendar"
      @open-settings="openSettings"
    />
    <main v-if="showSettings" class="body settings-body">
      <SettingsPanel
        v-model:carry-over="settings.carryOver"
        v-model:sort-checked="settings.sortChecked"
        v-model:allow-external-add="settings.allowExternalAdd"
        :data-root="dataRoot"
        @change-folder="changeFolder"
        @reveal-folder="revealDataRoot"
        @close="showSettings = false"
      />
      <AboutSection />
    </main>
    <main v-show="!showSettings" ref="body" class="body">
      <section class="pane today" :style="{ flexBasis: `${settings.splitRatio * 100}%` }">
        <DateBar v-model:date="viewDate" :today="today" @open-calendar="openCalendar" />
        <TodoList
          v-model="todayItems"
          ref="todayList"
          :sort-checked="settings.sortChecked"
          list-key="today"
          placeholder="새 할 일 입력"
          :marker="drag.state.marker"
          :dragging-id="drag.state.draggingId"
          @drag-start="(id, e) => drag.start('today', id, e)"
        />
      </section>
      <div class="split" title="끌어서 높이 조절" @pointerdown="startSplit"></div>
      <section class="pane someday">
        <div class="section-label">언젠가</div>
        <TodoList
          v-model="somedayItems"
          ref="somedayList"
          :sort-checked="settings.sortChecked"
          list-key="someday"
          placeholder="언젠가 할 일 입력"
          :marker="drag.state.marker"
          :dragging-id="drag.state.draggingId"
          @drag-start="(id, e) => drag.start('someday', id, e)"
        />
      </section>
    </main>
    <SaveStatusBar :status="saveStatus" :saved-at="savedAt">
      <span class="foot-end">
        <span v-if="aiNotice.notice.value" class="ai-added">
          <span class="msg"
            >{{ toolLabel(aiNotice.notice.value.by) }}가 {{ aiNotice.notice.value.count }}개 추가</span
          >
          <button data-action="undo-ai" @click="aiNotice.undo()">되돌리기</button>
        </span>
        <UpdatedNotice /><UpdateButton />
      </span>
    </SaveStatusBar>
  </div>
</template>

<style scoped>
.foot-end {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ai-added {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--ink);
}
.ai-added .msg {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-added button {
  flex: none;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.settings-body {
  overflow-y: auto;
  display: block;
}
.pane {
  min-height: 0;
  overflow-y: auto;
}
.today {
  flex-grow: 0;
  flex-shrink: 0;
}
.someday {
  flex: 1;
}
.split {
  flex: none;
  height: 9px;
  display: grid;
  place-items: center;
  cursor: row-resize;
  border-top: 1px solid var(--line);
  touch-action: none;
}
.split::after {
  content: "";
  width: 34px;
  height: 3px;
  border-radius: 2px;
  background: #55555a;
}
.section-label {
  font-size: 11.5px;
  color: var(--muted);
  padding: 3px 12px 4px;
}
</style>
