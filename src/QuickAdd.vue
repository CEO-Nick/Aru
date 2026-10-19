<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { nextTick, onMounted, reactive, ref, watch, watchEffect } from "vue";
import { dayPath } from "./composables/useRollover";
import { isRootUnavailable } from "./composables/useStorageHealth";
import { toIsoDate } from "./core/date";
import { keepDraft, orphanDrafts } from "./core/draftStash";
import { isBlankTodoText, normalizeTodoText } from "./core/text";
import { prependTodoIfNew } from "./core/todoFile";
import { updateFile } from "./platform/fileStore";
import { tauriStore } from "./platform/tauriStore";

type Target = "today" | "someday";

const draft = ref("");
const target = ref<Target>("today");
const input = ref<HTMLInputElement>();
const added = ref(false);
/** Enter 대신 보여 줄 짧은 안내(건너뜀, 저장 실패) */
const hint = ref<string | null>(null);
let busy = false;
/**
 * 다시 띄웠을 때 칸의 글과 고른 대상(오늘/언젠가)을 남길 때, 함께 다시 보여 줄 안내("" = 안내 없음). null이면 남기지 않는다.
 * 저장하지 못한 글은 Esc로 닫았다 다시 띄워도 저장되지 않았다는 걸 알아야 한다
 */
const kept = ref<string | null>(null);
/**
 * 넣는 중에 칸의 앞부분(넣은 글)을 고치거나 지웠는가. 그러면 칸 글은 이어 친 글이 아니라 새로 친 글이다 —
 * 같은 말로 시작해도 앞을 잘라 내면 안 된다
 */
let retyped = false;
/** 지금 넣는 중인 글 */
let sent: string | null = null;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * 창을 다시 띄울 때마다 바뀐다. 앞 창에서 누른 Enter의 저장이 늦게 끝나도 새 창을 닫거나 새 글을 지우지 않게,
 * 저장이 끝난 뒤 화면을 만지기 전에 자기가 시작한 창인지 확인한다
 */
let session = 0;
/**
 * 앞 창에서 넣다 실패했는데 그때 칸에 다른 글이 있어 되돌리지 못한 글. 버리지 않고 들고 있다가
 * 칸이 비는 다음 순간(지금 글을 넣은 직후, 또는 다시 띄웠을 때 남긴 글이 없으면) 칸에 되돌린다
 */
const unsaved = reactive<{ text: string; target: Target }[]>([]);
const UNSAVED_BACK = "앞서 넣으려던 글을 저장하지 못했어요";

// 칸에 남긴 글과 들고 있는 앞 글은 종료하면 사라진다(종료는 이 창을 기다리지 않는다). 이 맥에 남겨 두고 다음에 켤 때 작은 창이 목록에 넣는다.
// 거울에 지난 실행의 글이 남아 있으면(켜자마자 ⌥Space라 작은 창이 아직 옮기지 못함) 첫 실행이 빈 상태로 덮기 전에 넘길 글로 옮긴다
orphanDrafts("quick");
watchEffect(
  () => {
    const texts: Record<Target, string[]> = { today: [], someday: [] };
    if (kept.value !== null) texts[target.value].push(draft.value);
    for (const u of unsaved) texts[u.target].push(u.text);
    for (const t of ["today", "someday"] as const) keepDraft(`quick.${t}`, texts[t].filter((x) => !isBlankTodoText(x)).join("\n"));
  },
  { flush: "sync" },
);

const close = () => invoke("hide_quick");
const short = (text: string) => (text.length > 12 ? `${text.slice(0, 12)}…` : text);

function closeSoon(ms: number) {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(close, ms);
}

function restoreUnsaved() {
  const next = unsaved.shift()!;
  draft.value = next.text;
  target.value = next.target;
  kept.value = UNSAVED_BACK;
  hint.value = UNSAVED_BACK;
}

function reset() {
  // 방금 적고 닫히기 전에 다시 띄웠으면, 이전 입력의 닫기가 새 창을 닫지 않게 한다
  session++;
  clearTimeout(closeTimer);
  added.value = false;
  hint.value = null;
  busy = false;
  // 남긴 글을 사용자가 지웠으면 남길 것이 없다. 빈 칸은 늘 오늘로 시작하고, 들고 있던 앞 글이 있으면 그걸 꺼낸다
  if (kept.value === null || isBlankTodoText(draft.value)) {
    kept.value = null;
    draft.value = "";
    target.value = "today";
    if (unsaved.length) restoreUnsaved();
  } else if (unsaved.length) {
    hint.value = `저장하지 못한 앞 글이 있어요: ${short(unsaved[0].text)}`;
  } else hint.value = kept.value || null;
  nextTick(() => input.value?.focus());
}

// 안내는 다시 고치기 시작하면 내리고, 건너뜀 안내 뒤 닫기 예약도 거둔다(고쳐 쓴 글을 넣을 수 있게).
// 바로(sync) 반응해야 코드가 글을 되돌린 직후에 띄운 안내를 뒤늦게 지우지 않는다
watch(
  draft,
  (value) => {
    if (busy) {
      if (sent !== null && !value.startsWith(sent)) retyped = true;
      return;
    }
    hint.value = null;
    clearTimeout(closeTimer);
  },
  { flush: "sync" },
);

// 넣은 글 안쪽을 고르거나 그 앞에 커서를 두고 치면(전체 선택 후 붙여넣기 등) 이어 친 것이 아니다
function onBeforeInput() {
  if (busy && sent !== null && (input.value?.selectionStart ?? 0) < sent.length) retyped = true;
}

/** 칸 글 가운데 넣는 중에 이어 친 부분. 새로 친 글이면 칸 글 전부 */
function typedAfter(raw: string): string {
  return !retyped && draft.value.startsWith(raw) ? draft.value.slice(raw.length).trim() : draft.value;
}

async function submit() {
  const raw = draft.value;
  if (busy) return;
  if (isBlankTodoText(raw)) {
    // 들고 있던 앞 글이 있으면 닫지 않고 꺼낸다. 닫으면 그 글은 보이지 않는 채 메모리에만 남는다
    if (unsaved.length) return restoreUnsaved();
    kept.value = null;
    return close();
  }
  busy = true;
  sent = raw;
  retyped = false;
  const mine = session;
  const chosen = target.value;
  const text = normalizeTodoText(raw).trim();
  const path = chosen === "today" ? dayPath(toIsoDate(new Date())) : "someday.md";
  let skipped = false;
  try {
    // 읽고 쓰는 사이 aru 명령·다른 창이 쓴 것을 덮어쓰지 않게, 바뀌었으면 다시 읽어 넣는다
    await updateFile(tauriStore, path, (content) => {
      const result = prependTodoIfNew(content, text);
      skipped = result.skipped;
      return skipped ? null : result.content;
    });
  } catch (e) {
    const reason = isRootUnavailable(e) ? "저장 폴더를 열 수 없어요" : "저장하지 못했어요";
    if (mine !== session && (draft.value !== "" || busy)) {
      // 새 창이 같은 글을 같은 곳에 넣는 중이거나 넣으려고 칸에 두었으면 그 글이 곧 넣을 글이다. 따로 들면 같은 글이 두 번 돌아온다.
      // 그 밖에는 새 창의 글을 건드리지 않고, 못 넣은 앞 글은 따로 들고 있다가 칸이 비면 되돌린다
      if (draft.value === raw && target.value === chosen) {
        if (busy) return;
      } else {
        unsaved.push({ text: raw, target: chosen });
        hint.value = `저장하지 못한 앞 글이 있어요: ${short(raw)}`;
        return;
      }
    } else if (draft.value !== raw && !isBlankTodoText(typedAfter(raw))) {
      // 넣는 중에 이어 친 글이 있다: 둘을 붙이면 한 할 일이 되므로 이어 친 글은 칸에 두고 못 넣은 글은 따로 들고 있다
      draft.value = typedAfter(raw);
      unsaved.push({ text: raw, target: chosen });
      busy = false;
      kept.value = reason;
      hint.value = `${reason}: ${short(raw)}`;
      return;
    }
    // 창을 닫지 않고 글을 남긴다. 넣는 중에 칸을 비웠어도(공백만 남겨도) 못 넣은 글은 칸에 되돌린다.
    // 다른 곳을 누르거나 Esc로는 평소처럼 닫힌다
    draft.value = raw;
    target.value = chosen;
    busy = false;
    kept.value = reason;
    hint.value = unsaved.length ? `${reason} · 앞 글도 남아 있어요` : reason;
    return;
  }
  // 앞 창의 Enter였다: 넣기는 했고, 새 창은 그대로 둔다
  if (mine !== session) return;
  kept.value = null;
  busy = false;
  // 쓰는 동안 이어 친 글자가 있으면 닫지 않고 남긴다(Enter로 이어서 넣을 수 있게).
  // 끝에 이어 쳤으면 그 부분만 남긴다 — 그대로 두면 넣은 글을 품은 할 일이 하나 더 생긴다
  if (draft.value !== raw) {
    const rest = typedAfter(raw);
    if (!isBlankTodoText(rest)) {
      draft.value = rest;
      kept.value = "";
      return;
    }
  }
  if (unsaved.length) return restoreUnsaved();
  if (skipped as boolean) {
    // 이어서 고쳐 쓰면 그 글을 넣을 수 있게 입력을 다시 받는다
    hint.value = "이미 있는 할 일이에요";
    closeSoon(900);
    return;
  }
  busy = true;
  hint.value = null;
  added.value = true;
  closeSoon(260);
}

// 한글 조합을 확정하는 Enter는 무시한다(할 일 목록과 같은 규칙)
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    void close();
  } else if (event.key === "Tab") {
    event.preventDefault();
    target.value = target.value === "today" ? "someday" : "today";
  } else if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    void submit();
  }
}

onMounted(async () => {
  document.documentElement.classList.add("quick-root");
  reset();
  await listen("quick-shown", reset);
  // Spotlight처럼 다른 곳을 누르면 닫는다
  window.addEventListener("blur", () => {
    if (!busy) void close();
  });
});
</script>

<template>
  <div class="quick" :class="{ added }">
    <svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" />
      <path v-if="added" d="M4.6 8.2l2.3 2.3 4.6-5" />
    </svg>
    <input
      ref="input"
      v-model="draft"
      :placeholder="target === 'today' ? '오늘 할 일 추가' : '언젠가 할 일 추가'"
      aria-label="빠른 할 일 입력"
      spellcheck="false"
      @keydown="onKeydown"
      @beforeinput="onBeforeInput"
    />
    <button class="target" type="button" :class="target" title="Tab으로 바꾸기" @mousedown.prevent @click="target = target === 'today' ? 'someday' : 'today'">
      {{ target === "today" ? "오늘" : "언젠가" }}
    </button>
    <span class="hint" :class="{ notice: !!hint }" :title="hint ?? undefined">{{ hint ?? (added ? "추가됨" : "Enter") }}</span>
  </div>
</template>

<style>
/* 앱스토어판은 창이 곧 막대다(투명 창 불가). 둥근 모서리·그림자는 macOS 창이 그린다 */
.quick-root,
.quick-root body,
.quick-root #app {
  background: #262628 !important;
}
</style>

<style scoped>
.quick {
  height: 100vh;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px 0 18px;
  box-sizing: border-box;
  transition: box-shadow 0.2s ease;
}
.quick.added {
  box-shadow: inset 0 0 0 1px rgba(48, 209, 88, 0.6);
}
.mark {
  flex: none;
  width: 20px;
  height: 20px;
  fill: none;
  stroke: #8e8e93;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.added .mark {
  stroke: #30d158;
}
input {
  flex: 1;
  min-width: 0;
  background: none;
  border: 0;
  outline: 0;
  color: var(--ink);
  font: 400 20px/1 -apple-system, "Apple SD Gothic Neo", sans-serif;
  letter-spacing: -0.01em;
}
input::placeholder {
  color: #6f6f75;
}
.target {
  flex: none;
  border: 0;
  border-radius: 6px;
  padding: 4px 9px;
  font: 600 12px -apple-system, "Apple SD Gothic Neo", sans-serif;
  cursor: pointer;
}
.target.today {
  background: rgba(10, 132, 255, 0.22);
  color: #6cb4ff;
}
.target.someday {
  background: rgba(255, 159, 10, 0.2);
  color: #ffb340;
}
.hint {
  flex: none;
  font: 500 11px "SF Mono", Menlo, monospace;
  color: #6f6f75;
  min-width: 38px;
  text-align: right;
}
.added .hint {
  color: #30d158;
}
.hint.notice {
  font: 500 12px -apple-system, "Apple SD Gothic Neo", sans-serif;
  color: #ffb340;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
