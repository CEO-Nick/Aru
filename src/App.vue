<script setup lang="ts">
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onMounted, ref, watch } from "vue";
import DateBar from "./components/DateBar.vue";
import SaveStatusBar from "./components/SaveStatus.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import TitleBar from "./components/TitleBar.vue";
import TodoList from "./components/TodoList.vue";
import { useListDrag } from "./composables/useListDrag";
import { dayPath, rollover } from "./composables/useRollover";
import { useSettings } from "./composables/useSettings";
import { useTodoFile } from "./composables/useTodoFile";
import { AutoSaver, type SaveStatus } from "./core/autoSaver";
import { toIsoDate } from "./core/date";
import { splitRatio } from "./core/layout";
import { sliderToAlpha } from "./core/opacity";
import { getDataRoot, onDataRootChanged, pickDataRoot, revealDataRoot } from "./platform/dataRoot";
import { onFileChanged, onShowDate, openOverview } from "./platform/events";
import { tauriStore } from "./platform/tauriStore";
import { tauriWindow } from "./platform/tauriWindow";

const saver = new AutoSaver(tauriStore);
const saveStatus = ref<SaveStatus>("saved");
saver.onStatus((s) => (saveStatus.value = s));

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
    const wasViewingToday = viewDate.value === today.value;
    await rollover(now, settings, tauriStore, saver, somedayItems);
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
  void openOverview();
}

const drag = useListDrag({ today: todayItems, someday: somedayItems });

const body = ref<HTMLElement>();

function startSplit(event: PointerEvent) {
  event.preventDefault();
  const onMove = (e: PointerEvent) => {
    const rect = body.value!.getBoundingClientRect();
    settings.value.splitRatio = splitRatio(e.clientY, rect.top, rect.height);
  };
  const onUp = () => {
    document.body.classList.remove("resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  document.body.classList.add("resizing");
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

watch(
  () => settings.value.opacity,
  (value) => void tauriWindow.setOpacity(sliderToAlpha(value)),
);

onMounted(async () => {
  await Promise.all([loadSettings(), somedayFile.load()]);
  await rollover(today.value, settings, tauriStore, saver, somedayItems);
  await dayFile.load();
  void tauriWindow.setOpacity(sliderToAlpha(settings.value.opacity));
  if (!settings.value.alwaysOnTop) void tauriWindow.setAlwaysOnTop(false);

  window.addEventListener("blur", () => void saver.flush());
  // 잠자기에서 깨어나면 타이머가 늦게 돌 수 있어서 창이 다시 활성화될 때도 날짜를 확인한다
  setInterval(() => void checkDayChange(), 30_000);
  window.addEventListener("focus", () => {
    void checkDayChange();
    void dayFile.reloadIfChanged();
    void somedayFile.reloadIfChanged();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void saver.flush();
  });
  await getCurrentWindow().onCloseRequested(async () => {
    await saver.flush();
  });
  await onFileChanged(({ path }) => {
    if (path === dayFile.path.value) void dayFile.reloadIfChanged();
    if (path === somedayFile.path.value) void somedayFile.reloadIfChanged();
  });
  // 저장 폴더가 바뀌면 모든 걸 새 폴더에서 다시 읽는다
  await onDataRootChanged(() => location.reload());
  await onShowDate((date) => {
    viewDate.value = date;
    void getCurrentWindow().show();
  });
  await listen("quit-requested", async () => {
    await saver.flush();
    await invoke("exit_app");
  });
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
        :data-root="dataRoot"
        @change-folder="changeFolder"
        @reveal-folder="revealDataRoot"
        @close="showSettings = false"
      />
    </main>
    <main v-show="!showSettings" ref="body" class="body">
      <section class="pane today" :style="{ flexBasis: `${settings.splitRatio * 100}%` }">
        <DateBar v-model:date="viewDate" :today="today" @open-calendar="openCalendar" />
        <TodoList
          v-model="todayItems"
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
          list-key="someday"
          placeholder="언젠가 할 일 입력"
          :marker="drag.state.marker"
          :dragging-id="drag.state.draggingId"
          @drag-start="(id, e) => drag.start('someday', id, e)"
        />
      </section>
    </main>
    <SaveStatusBar :status="saveStatus" />
  </div>
</template>

<style scoped>
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
