<script setup lang="ts">
import type { CarryOver } from "../core/settings";

defineProps<{ carryOver: CarryOver; sortChecked: boolean; allowExternalAdd: boolean; dataRoot: string }>();
const emit = defineEmits<{
  "update:carryOver": [value: CarryOver];
  "update:sortChecked": [value: boolean];
  "update:allowExternalAdd": [value: boolean];
  "change-folder": [];
  "reveal-folder": [];
  close: [];
}>();

const OPTIONS: { value: CarryOver; title: string; hint: string }[] = [
  { value: "keep", title: "그 날짜에 그대로 남기기", hint: "새 날은 빈 칸으로 시작한다." },
  { value: "next-day", title: "다음 날로 옮기기", hint: "미리 적어 둔 항목 아래에 붙는다." },
  { value: "someday", title: "언젠가로 옮기기", hint: "아래 목록 맨 끝에 붙는다." },
];
</script>

<template>
  <div class="settings">
    <div class="head">
      <span>설정</span>
      <button class="close" data-action="close" title="목록으로" @click="emit('close')">완료</button>
    </div>

    <h4>자정에 남은 미완료 항목</h4>
    <div role="radiogroup">
      <div
        v-for="option in OPTIONS"
        :key="option.value"
        class="radio"
        role="radio"
        :aria-checked="carryOver === option.value"
        :class="{ on: carryOver === option.value }"
        @click="emit('update:carryOver', option.value)"
      >
        <span class="rb"></span>
        <span>
          <b>{{ option.title }}</b>
          <small>{{ option.hint }}</small>
        </span>
      </div>
    </div>

    <hr />

    <h4>끝낸 일</h4>
    <div
      class="switch-row"
      role="switch"
      data-setting="sortChecked"
      tabindex="0"
      :aria-checked="sortChecked"
      @click="emit('update:sortChecked', !sortChecked)"
      @keydown.space.prevent="emit('update:sortChecked', !sortChecked)"
    >
      <span>
        <b>아래로 보내기</b>
        <small>체크하고 0.5초 뒤 끝낸 일들 맨 위로 옮긴다. 그 사이 다시 누르면 취소된다.</small>
      </span>
      <span class="switch" :class="{ on: sortChecked }"><i></i></span>
    </div>

    <hr />

    <h4>AI · 명령어</h4>
    <div
      class="switch-row"
      role="switch"
      data-setting="allowExternalAdd"
      tabindex="0"
      :aria-checked="allowExternalAdd"
      @click="emit('update:allowExternalAdd', !allowExternalAdd)"
      @keydown.space.prevent="emit('update:allowExternalAdd', !allowExternalAdd)"
    >
      <span>
        <b>AI·명령어로 추가 허용</b>
        <small>Claude Code 같은 AI 도구나 aru 명령이 할 일을 넣을 수 있다. 넣은 할 일엔 AI 태그가 붙는다.</small>
      </span>
      <span class="switch" :class="{ on: allowExternalAdd }"><i></i></span>
    </div>

    <hr />

    <h4>저장 폴더</h4>
    <div class="path">{{ dataRoot }}</div>
    <div class="buttons">
      <button class="btn" data-action="change-folder" @click="emit('change-folder')">폴더 변경…</button>
      <button class="btn" data-action="reveal-folder" @click="emit('reveal-folder')">Finder에서 열기</button>
    </div>
    <p class="note">
      날짜별 마크다운 파일로 저장된다. OneDrive, Dropbox, Obsidian 볼트 폴더를 고르면 다른 컴퓨터와
      함께 쓸 수 있다. 빈 폴더를 고르면 지금까지의 할 일을 복사해 간다.
    </p>
  </div>
</template>

<style scoped>
.settings {
  padding: 10px 14px 14px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 10px;
}
button {
  font: inherit;
  cursor: pointer;
}
.close {
  border: 0;
  background: var(--accent);
  color: #fff;
  border-radius: 6px;
  padding: 2px 10px;
  font-size: 12px;
}
h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
}
.radio {
  display: flex;
  gap: 9px;
  padding: 7px 8px;
  border-radius: 7px;
  cursor: pointer;
}
.radio:hover {
  background: rgba(255, 255, 255, 0.05);
}
.radio b {
  display: block;
  font-weight: 500;
}
.radio small {
  color: var(--muted);
  font-size: 11.5px;
}
.rb {
  flex: none;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 1.5px solid #77777d;
  margin-top: 3px;
}
.radio.on .rb {
  border: 4.5px solid var(--accent);
}
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 8px;
  border-radius: 7px;
  cursor: pointer;
}
.switch-row:hover {
  background: rgba(255, 255, 255, 0.05);
}
.switch-row b {
  display: block;
  font-weight: 500;
}
.switch-row small {
  color: var(--muted);
  font-size: 11.5px;
}
.switch {
  flex: none;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: #4a4a4e;
  position: relative;
  transition: background 0.2s ease;
}
.switch i {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s ease;
}
.switch.on {
  background: #30d158;
}
.switch.on i {
  transform: translateX(14px);
}
hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 12px 0;
}
.path {
  font: 11.5px "SF Mono", Menlo, monospace;
  background: #1c1c1e;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 7px 8px;
  color: #cfcfd4;
  word-break: break-all;
}
.buttons {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.btn {
  border: 1px solid var(--line);
  background: #3a3a3d;
  color: var(--ink);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
}
.note {
  color: var(--muted);
  font-size: 11.5px;
  margin: 10px 0 0;
}
</style>
