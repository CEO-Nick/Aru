<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onMounted, ref, watch, type Ref } from "vue";
import AboutSection from "./components/AboutSection.vue";
import AiConnect from "./components/AiConnect.vue";
import DateBar from "./components/DateBar.vue";
import SaveStatusBar from "./components/SaveStatus.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import TitleBar from "./components/TitleBar.vue";
import TodoList from "./components/TodoList.vue";
import { watchDayChange } from "./composables/useDayWatcher";
import { invoke } from "@tauri-apps/api/core";
import { useAiNotice, type AiBatch } from "./composables/useAiNotice";
import { useListDrag } from "./composables/useListDrag";
import { dayPath, rollover, serialized } from "./composables/useRollover";
import { useSettings } from "./composables/useSettings";
import { useTodoFile } from "./composables/useTodoFile";
import { useSaveIndicator } from "./composables/useSaveIndicator";
import { isRootUnavailable, reloadedForFolder, RESTORED_DRAFT, switchFolder, useStorageHealth } from "./composables/useStorageHealth";
import { AutoSaver } from "./core/autoSaver";
import { inDateRange, toIsoDate } from "./core/date";
import { dropOrphan, keptDraft, orphan, orphanDrafts, orphans } from "./core/draftStash";
import { splitRatio } from "./core/layout";
import { sliderToAlpha } from "./core/opacity";
import { dataRootInfo, onDataRootChanged, revealDataRoot } from "./platform/dataRoot";
import { folderLabel } from "./core/folderLabel";
import { toolLabel } from "./core/format";
import { onFileChanged, onShowDate, openOverview } from "./platform/events";
import { onQuitRequested, onQuitWaiting, readyToQuit } from "./platform/lifecycle";
import { tauriStore } from "./platform/tauriStore";
import { tauriWindow } from "./platform/tauriWindow";
import type { WindowControl } from "./platform/windowControl";

const health = useStorageHealth();
/** 폴더를 바꿔 새로고침된 창(다른 창도 떠 있다) */
const reloaded = reloadedForFolder();
// 빠른 입력창·모아보기는 앱을 켤 때 아직 없다. 그 창들이 지난 실행에 남긴 거울은 기다리기 전에 넘길 글로 옮긴다 —
// 켜자마자 ⌥Space로 뜬 빠른 입력창이 제 거울을 빈 상태로 덮기 전에(리뷰 H1). 새로고침된 때는 그 창들이 떠 있어 제 글을 제가 되돌린다
if (!reloaded) {
  orphanDrafts("quick");
  orphanDrafts("overview");
}
const store = health.guard(tauriStore);
const saver = new AutoSaver(store);
const todayList = ref<InstanceType<typeof TodoList>>();
const somedayList = ref<InstanceType<typeof TodoList>>();
function commitDrafts() {
  todayList.value?.commitDraft();
  somedayList.value?.commitDraft();
}
const { status: saveStatus, savedAt, saveNow } = useSaveIndicator(saver, commitDrafts);

const {
  settings,
  load: loadSettings,
  recover: recoverSettings,
  error: settingsError,
  ready: settingsReady,
  refresh: refreshSettings,
} = useSettings(store, saver);

/** 실제 오늘 */
const today = ref(toIsoDate(new Date()));
/** 위쪽 목록이 보여주는 날짜. ◀ ▶ 로 바뀐다 */
const viewDate = ref(today.value);
const dayFile = useTodoFile(
  computed(() => dayPath(viewDate.value)),
  store,
  saver,
);
const somedayFile = useTodoFile(ref("someday.md"), store, saver);
const todayItems = dayFile.items;
const somedayItems = somedayFile.items;

/** 자정이 지나 보던 날을 새 날로 옮기는 중 */
let dayRolled = false;
// 사용자가 날짜를 옮기면 입력칸에 쓰다 만 글은 떠나는 날에 넣는다. 읽는 동안에는 입력칸이 없어 그대로 두면 그사이 종료할 때 잃는다.
// 자정에는 넣지 않고 입력칸에 남겨 새 날로 따라가게 한다 — 정리가 끝난 어제에 넣으면 옮겨지지 않고 지난 날에 묻힌다
watch(viewDate, (_, old) => {
  if (!dayRolled) leaveDay();
  dayRolled = false;
  void dayFile.load(() => saver.flush(dayPath(old)));
});

/**
 * 떠나는 날에 입력칸 글을 넣는다. 그 목록이 막혀(또는 아직 읽는 중이라) 넣지 못하면 글을 따라가게 두지 않고
 * 넘길 글로 맡긴다 — 따라가면 이미 정리가 끝난 지난 날에 들어가 묻힌다(QA11 B2). 오늘 목록이 받을 수 있을 때 오늘에 넣는다
 */
function leaveDay() {
  const list = todayList.value;
  if (list && !list.commitDraft()) orphan("main.today", [list.takeDraft()]);
}

/** 자정 정리에서 읽지 못해 건너뛴 지난 날짜 파일 */
const rolloverUnreadable = ref<string[]>([]);
const runRollover = serialized(rollover);
/** 쓰는 중이라 미룬 날마다 미룬 그때의 할 일(그 뒤 새로 적은 할 일은 옮기지 않게) */
const deferred = new Map<string, string[]>();

/**
 * 자정 정리. 설정을 못 읽었으면(기록된 날짜를 모름) 하지 않고, 언젠가로 옮길 때 언젠가를 못 읽었으면 하지 않는다.
 * 지난 날 파일을 못 읽으면 그날만 건너뛰고 창 아래에 알린다. 저장 폴더를 열 수 없으면 다음에 다시 한다
 */
async function safeRollover(now: string, previous?: string) {
  if (!settingsReady.value) return;
  if (settings.value.carryOver === "someday" && !somedayFile.loaded.value) return;
  // 위 목록에 열린 날(오늘이든 보고 있던 지난 날이든)은 목록으로 옮긴다. 파일에 따로 쓰면 화면이 모른 채 다음 편집이 덮어쓴다
  const openLists = () => [dayFile.openList()].filter((l) => l !== null);
  try {
    const result = await runRollover(now, settings, store, saver, somedayItems, { previousDay: previous, openLists, deferred });
    rolloverUnreadable.value = result.unreadable;
  } catch {
    // 저장 폴더를 열 수 없으면 창 아래 알림으로 보이고, 폴더가 돌아오면 다시 한다
  }
}

// 미룬 날(쓰는 중이던 편집이 있던 날)은 그 쓰기가 끝나면 바로 다시 정리한다. 다음 자정까지 기다리지 않게
saver.onWrite((path) => {
  if (settings.value.rolloverPending?.some((date) => path === dayPath(date))) void safeRollover(today.value);
});

/** 읽을 수 있는가. 저장 폴더를 열 수 없는 것은 목록이 잠기지 않으므로(적어 두었다가 돌아오면 합친다) 읽을 수 있는 것으로 본다 */
async function readable(path: string) {
  try {
    await store.read(path);
    return true;
  } catch (e) {
    return isRootUnavailable(e);
  }
}

// 오늘 파일을 못 읽어 미뤄진 자정 정리는 그 파일이 다시 읽히면 바로 한다. 다음 자정·재시작까지 떠나는 날에 묻히지 않게
watch(dayFile.error, (now, before) => {
  if (before && !now && viewDate.value === today.value) void safeRollover(today.value);
});

let retrying = false;
/**
 * 미뤄진 자정 정리를 다시 해 본다(3초 확인·창 포커스). 위 감시는 오늘을 보는 중에 오류가 풀리는 순간만 잡아서,
 * ◀로 다른 날을 보는 사이 풀리거나 미리 읽기는 됐는데 정리만 실패하면 다음 자정·재시작까지 어제에 묻힌다.
 * 막고 있던 파일(정리가 통째로 미뤄졌으면 오늘, 아니면 남겨 둔 날)이 읽힐 때만 한다 — 그대로면 3초마다 정리가
 * 저장 대기분을 바로 쓰고 실패한다
 */
async function retryRollover() {
  const { lastRolloverDate: last, rolloverPending = [] } = settings.value;
  if (retrying || checking || !last || health.unavailable.value !== null) return;
  const waiting = last < today.value ? [today.value] : rolloverPending;
  if (!waiting.length) return;
  retrying = true;
  try {
    if ((await Promise.all(waiting.map((date) => readable(dayPath(date))))).includes(true)) await safeRollover(today.value);
  } finally {
    retrying = false;
  }
}

let checking = false;
async function checkDayChange() {
  const now = toIsoDate(new Date());
  if (now === today.value || checking) return;
  checking = true;
  try {
    const previous = today.value;
    const wasViewingToday = viewDate.value === previous;
    await safeRollover(now, previous);
    today.value = now;
    if (wasViewingToday) {
      // 새 날을 읽지 못하면 그 목록은 입력칸 없이 잠겨 글이 안 보이고 종료할 때 잃는다. 그때만 떠나는 날에 넣는다 —
      // 새 날을 못 읽으면 자정 정리도 미뤄지므로, 읽히면 떠나는 날의 다른 할 일과 함께 설정대로 옮겨진다
      if (!(await readable(dayPath(now)))) todayList.value?.commitDraft();
      dayRolled = true;
      viewDate.value = now;
    } else await dayFile.load();
  } finally {
    checking = false;
  }
}

const showSettings = ref(false);
const dataRoot = ref({ label: "", title: "" });

async function openSettings() {
  showSettings.value = !showSettings.value;
  if (showSettings.value) dataRoot.value = folderLabel(await dataRootInfo());
}

const changeFolder = () => health.repick(() => saver.flush());

/** 창에 마지막으로 맞춘 값(모르면 null). 창은 항상 위로 뜬다(tauri.conf) */
const applied: { alpha: number | null; pin: boolean | null } = { alpha: null, pin: true };
/**
 * 같은 값은 다시 보내지 않는다. 슬라이더·핀은 누를 때 바로 맞추고, 아래 감시가 같은 값으로 한 번 더 부른다.
 * 보내기 전에 적어 두어야 그 사이 오는 같은 값을 거르고, 실패하면 지워 다음 확인(applyWindow)에 다시 보낸다
 */
const windowControl: WindowControl = {
  async setOpacity(alpha) {
    if (alpha === applied.alpha) return;
    applied.alpha = alpha;
    await tauriWindow.setOpacity(alpha).catch((e) => {
      if (applied.alpha === alpha) applied.alpha = null;
      throw e;
    });
  },
  async setAlwaysOnTop(on) {
    if (on === applied.pin) return;
    applied.pin = on;
    await tauriWindow.setAlwaysOnTop(on).catch((e) => {
      if (applied.pin === on) applied.pin = null;
      throw e;
    });
  },
};
function applyWindow() {
  windowControl.setOpacity(sliderToAlpha(settings.value.opacity)).catch(() => {});
  windowControl.setAlwaysOnTop(settings.value.alwaysOnTop).catch(() => {});
}
// 설정을 어디서 다시 읽든(폴더 변경·폴더 복구·못 읽던 파일 복구) 창은 여기 한 곳에서 맞춘다
watch(() => [settings.value.opacity, settings.value.alwaysOnTop], applyWindow);

/** 읽지 못해 쓰지 않고 있는 파일 */
const unreadable = computed(() =>
  [
    settingsError.value && "settings.json",
    dayFile.error.value && dayFile.path.value,
    somedayFile.error.value && somedayFile.path.value,
    ...rolloverUnreadable.value.filter((p) => p !== dayFile.path.value),
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
const footAlertTitle = computed(() =>
  health.unavailable.value
    ? `${health.unavailable.value} — 고친 내용은 창에 남아 있고, 폴더가 다시 열리면 저장해요`
    : "",
);
const BLOCKED = "읽지 못한 파일이라 고칠 수 없어요";
// 다 읽기 전(날짜를 바꾸는 중 포함)에 적은 글은 곧 읽은 내용으로 덮여 사라지므로 받지 않는다
const lockOf = (file: { error: Ref<string | null>; loaded: Ref<boolean> }) =>
  file.error.value ? BLOCKED : file.loaded.value ? null : "불러오는 중…";

/** 폴더가 돌아왔을 때: 보이는 목록·설정은 각자 합친다. 다른 날에 적어 둔 것은 자동저장이 쓸 때 그 파일과 합친다 */
async function recoverAll() {
  await Promise.all([dayFile.recover(), somedayFile.recover(), recoverSettings()]);
}

async function checkStorage() {
  if (!(await health.check(recoverAll))) return retryRollover();
  await saver.flush();
  await safeRollover(today.value);
}

function openCalendar() {
  void openOverview(viewDate.value);
}

const drag = useListDrag(
  { today: todayItems, someday: somedayItems },
  { canDropTo: (key) => !!(key === "today" ? dayFile : somedayFile).openList() },
);
const aiNotice = useAiNotice({
  shown: [
    { path: dayFile.path, items: todayItems, open: () => !!dayFile.openList() },
    { path: somedayFile.path, items: somedayItems, open: () => !!somedayFile.openList() },
  ],
  store,
  recentBatches: () => invoke<AiBatch[]>("recent_ai_batches"),
  todayPath: () => dayPath(today.value),
});

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
let lastReload = -Infinity;
async function reloadFiles() {
  // 시계를 바꿔도 흔들리지 않게 단조 시간으로 잰다
  if (performance.now() - lastReload < 2000) return;
  lastReload = performance.now();
  await Promise.all([dayFile.reloadIfChanged(), somedayFile.reloadIfChanged()]);
}

async function pollExternal() {
  // 알림은 다시 읽은 목록을 보고 판단한다. 먼저 보면 방금 들어온 묶음을 "이미 지워졌다"로 보고 내린다
  await reloadFiles();
  void aiNotice.poll();
  void checkStorage();
  applyWindow();
  if (settingsError.value) void recoverSettings();
  else void refreshSettings();
  adoptOrphanDrafts();
}

/**
 * 넘길 글을 할 일로 하나씩 넣는다(한 줄 입력칸에 합쳐 되돌리지 않는다). 넘길 글을 넣는 곳은 이 창 하나뿐이다.
 * 오늘 몫은 오늘을 볼 때만 위 목록에, 나머지(날짜를 모르는 모아보기 글 포함)는 언젠가에. 받지 못하면 남겨 두고 다음 확인에 다시
 */
function adoptOrphanDrafts() {
  const found = orphans();
  const toToday = found.filter(({ slot }) => slot.endsWith(".today"));
  const targets = [
    { list: viewDate.value === today.value ? todayList.value : undefined, from: toToday },
    { list: somedayList.value, from: found.filter((o) => !toToday.includes(o)) },
  ];
  for (const { list, from } of targets) {
    if (from.length && list?.addNew(...from.flatMap((o) => o.texts))) from.forEach((o) => dropOrphan(o.slot));
  }
}

onMounted(async () => {
  // 파일 하나를 못 읽어도 나머지는 따로 읽고, 아래의 저장·감시는 반드시 건다
  await Promise.all([loadSettings(), somedayFile.load()]);
  await safeRollover(today.value);
  await dayFile.load();
  applyWindow();
  adoptOrphanDrafts();

  window.addEventListener("blur", () => void saver.flush());
  watchDayChange(() => void checkDayChange());
  window.addEventListener("focus", () => void reloadFiles());
  // 외장 디스크·iCloud가 붙었는지는 창을 다시 볼 때 바로 확인한다
  window.addEventListener("focus", () => void checkStorage());
  // 항상 떠 있는 창이라 클릭하지 않아도 다른 편집기에서 고친 내용이 보여야 한다
  // AI·명령어가 넣은 할 일이 클릭 없이도 바로 보이게 자주 확인한다. 바뀐 게 없으면 읽기만 하고 끝난다
  setInterval(() => void pollExternal(), 3_000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void saver.flush();
  });
  // 작은 창을 닫으면 앱을 끄지 않고 숨긴다. Dock 아이콘(Windows는 트레이)으로 다시 연다
  await getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault();
    await saveNow();
    await getCurrentWindow().hide();
  });
  await onFileChanged(({ path }) => {
    if (path === dayFile.path.value) void dayFile.reloadIfChanged();
    if (path === somedayFile.path.value) void somedayFile.reloadIfChanged();
    if (path === "settings.json") void refreshSettings();
  });
  // 저장 폴더가 바뀌면 모든 걸 새 폴더에서 다시 읽는다.
  // 그 전에 아직 쓰지 못한 것을 새 폴더 파일과 합쳐 쓴다(새로 읽으면 창에만 있던 내용이 사라진다)
  await onDataRootChanged((changed) =>
    switchFolder(health, saver, [dayFile, somedayFile], checkStorage, () => loadSettings({ adopt: true }), changed, commitDrafts),
  );
  await onShowDate(async (date) => {
    if (inDateRange(date)) viewDate.value = date;
    const win = getCurrentWindow();
    await win.unminimize();
    await win.show();
    await win.setFocus();
  });
  await onQuitRequested(saveNow);
  // 기다리는 동안 아무 표시가 없으면 종료가 먹지 않은 줄 안다. Rust가 폴더 옮기기를 기다리는 한도(60초)만큼 둔다.
  // 창을 숨겨 두었으면 안내가 보이지 않으므로 창을 띄운다
  await onQuitWaiting(async () => {
    health.notify("폴더를 옮기는 중이라 끝나면 종료해요", 60_000);
    const win = getCurrentWindow();
    await win.unminimize();
    await win.show();
  });
  if (reloaded) {
    // 옛 폴더의 막힌 목록에 넣지 못한 글은 새 폴더에 말없이 넣지 않는다. 입력칸에 되돌려 두고 알린다(리뷰 L4)
    if (keptDraft("main.today") || keptDraft("main.someday")) health.notify(RESTORED_DRAFT);
    void readyToQuit(() => saver.flush());
  }
});
</script>

<template>
  <div class="app">
    <TitleBar
      v-model:opacity="settings.opacity"
      v-model:always-on-top="settings.alwaysOnTop"
      :window-control="windowControl"
      @open-overview="openCalendar"
      @open-settings="openSettings"
    />
    <main v-if="showSettings" class="body settings-body">
      <SettingsPanel
        v-model:carry-over="settings.carryOver"
        v-model:sort-checked="settings.sortChecked"
        v-model:allow-external-add="settings.allowExternalAdd"
        :data-root="dataRoot.title"
        :data-root-label="dataRoot.label"
        @change-folder="changeFolder"
        @reveal-folder="revealDataRoot"
        @close="showSettings = false"
      >
        <template #ai><AiConnect :external-add-allowed="settings.allowExternalAdd" /></template>
      </SettingsPanel>
      <AboutSection />
    </main>
    <main v-show="!showSettings" ref="body" class="body">
      <section class="pane today" :style="{ flexBasis: `${settings.splitRatio * 100}%` }">
        <DateBar v-model:date="viewDate" :today="today" @open-calendar="openCalendar" />
        <TodoList
          v-model="todayItems"
          ref="todayList"
          :sort-checked="settings.sortChecked"
          :blocked="lockOf(dayFile)"
          list-key="today"
          draft-slot="main.today"
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
          :blocked="lockOf(somedayFile)"
          list-key="someday"
          draft-slot="main.someday"
          placeholder="언젠가 할 일 입력"
          :marker="drag.state.marker"
          :dragging-id="drag.state.draggingId"
          @drag-start="(id, e) => drag.start('someday', id, e)"
        />
      </section>
    </main>
    <SaveStatusBar
      :status="saveStatus"
      :saved-at="savedAt"
      :compact="!!aiNotice.notice.value"
      :alert="footAlert"
      :info="health.info.value"
      :alert-title="footAlertTitle"
    >
      <span v-if="health.unavailable.value !== null" class="folder-actions">
        <button data-action="repick-folder" @click="health.repick()">폴더 다시 고르기</button>
        <button data-action="default-folder" @click="health.useDefault()">기본 폴더 쓰기</button>
      </span>
      <span class="foot-end">
        <span v-if="aiNotice.notice.value" class="ai-added" :title="`${toolLabel(aiNotice.notice.value.by)}가 넣었어요`">
          <span class="msg"
            >{{ aiNotice.label(aiNotice.notice.value) }}AI {{ aiNotice.notice.value.count }}개 추가</span
          >
          <button data-action="undo-ai" @click="aiNotice.undo()">되돌리기</button>
        </span>
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
.folder-actions {
  display: flex;
  gap: 8px;
}
.folder-actions button,
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
