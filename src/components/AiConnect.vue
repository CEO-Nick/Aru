<script lang="ts">
import { ref } from "vue";

// 설정을 닫으면 이 컴포넌트는 사라졌다 다시 만들어진다. 설치 중 표시를 그 안에 두면 다시 열었을 때 버튼이 켜져 설치 창이 두 번 뜬다.
// 버튼 아래 말도 여기 둔다 — 설치 중에 닫았다면 그 결과(실패 이유)는 다시 열었을 때 보여야 한다
const installing = ref(false);
/** 버튼 아래에 남겨 두는 말. 고를 수 있어야 하는 명령·읽을 시간이 필요한 이유라 저절로 사라지지 않고 다음 누름에 바뀐다 */
const note = ref<{ text: string; command?: boolean } | null>(null);
</script>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { type AiTool, connectCommand } from "../core/aiConnect";
import { aiConnectInfo, installClaudeDesktop, type AiConnectInfo } from "../platform/aiConnect";
import { currentOs } from "../platform/os";

type Target = AiTool | "claude-desktop";

defineProps<{ externalAddAllowed: boolean }>();

const FEEDBACK_MS = 1500;
const LABELS: Record<Target, string> = { "claude-code": "Claude Code", codex: "Codex", "claude-desktop": "Claude 데스크톱" };

const info = ref<AiConnectInfo | null>(null);
const infoFailed = ref(false);
// 누른 버튼 하나만 잠깐 결과를 보여 준다. 팝업 대신 버튼 글자로 알린다
const feedback = ref<{ target: Target; text: string } | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

// 설정을 열 때마다 새로 그려지므로 Claude 데스크톱 설치 여부도 열 때마다 다시 본다
onMounted(async () => {
  info.value = await aiConnectInfo().catch(() => null);
  infoFailed.value = !info.value;
});
// 본 안내는 닫을 때 지운다. 설치 중이면 그 결과가 아직 오지 않았으므로 남긴다
onUnmounted(() => {
  clearTimeout(timer);
  if (!installing.value) note.value = null;
});

function show(target: Target, text: string) {
  clearTimeout(timer);
  feedback.value = { target, text };
  timer = setTimeout(() => (feedback.value = null), FEEDBACK_MS);
}

const label = (target: Target) => (feedback.value?.target === target ? feedback.value.text : LABELS[target]);

async function copy(tool: AiTool) {
  if (!info.value) return;
  const command = connectCommand(tool, info.value.command, currentOs());
  note.value = null;
  try {
    await navigator.clipboard.writeText(command);
    show(tool, "복사됨 ✓");
  } catch {
    show(tool, "복사 실패");
    note.value = { text: command, command: true };
  }
}

async function openClaudeDesktop() {
  // 두 번 누르면 Claude 설치 창이 두 번 뜬다
  if (installing.value) return;
  installing.value = true;
  note.value = null;
  // 앞선 실패의 "열지 못함"이 남아 있으면 이번 결과와 섞여 보인다
  if (feedback.value?.target === "claude-desktop") feedback.value = null;
  try {
    await installClaudeDesktop();
    note.value = { text: "Claude에서 설치를 확인해 주세요" };
  } catch (e) {
    show("claude-desktop", "열지 못함");
    note.value = { text: e instanceof Error ? e.message : String(e) };
  } finally {
    installing.value = false;
  }
}
</script>

<template>
  <div class="connect">
    <b>AI 도구에 연결</b>
    <small>Claude Code·Codex는 명령을 복사해 터미널에서 실행하세요. 이미 열려 있었다면 다시 시작해야 보여요.</small>
    <small v-if="!externalAddAllowed" class="off">지금은 AI·명령어로 추가가 꺼져 있어요.</small>
    <div class="buttons">
      <button class="btn" data-action="connect-claude-code" :disabled="!info" @click="copy('claude-code')">
        {{ label("claude-code") }}
      </button>
      <button class="btn" data-action="connect-codex" :disabled="!info" @click="copy('codex')">
        {{ label("codex") }}
      </button>
      <button
        v-if="info?.claudeDesktop"
        class="btn"
        data-action="connect-claude-desktop"
        :disabled="installing"
        @click="openClaudeDesktop"
      >
        {{ label("claude-desktop") }}
      </button>
    </div>
    <small v-if="infoFailed" class="note">연결 정보를 읽지 못했어요. 설정을 다시 열어 보세요.</small>
    <code v-else-if="note?.command" class="note command">{{ note.text }}</code>
    <small v-else-if="note" class="note">{{ note.text }}</small>
  </div>
</template>

<style scoped>
.connect {
  padding: 7px 8px 0;
}
.connect b {
  display: block;
  font-weight: 500;
}
.connect small {
  display: block;
  color: var(--muted);
  font-size: 11.5px;
}
.note {
  display: block;
  margin-top: 6px;
}
.command {
  font-size: 11px;
  word-break: break-all;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.btn {
  border: 1px solid var(--line);
  background: #3a3a3d;
  color: var(--ink);
  border-radius: 6px;
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
