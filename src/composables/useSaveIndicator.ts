import { ref } from "vue";
import type { AutoSaver, SaveStatus } from "../core/autoSaver";

/**
 * 하단 저장 표시 상태와 Cmd+S(윈도우는 Ctrl+S). Cmd+S는 기다리던 저장을 바로 쓰고,
 * 쓸 게 없어도 "저장됨"을 반짝여 눌렀다는 걸 알려 준다.
 */
export function useSaveIndicator(saver: AutoSaver) {
  const status = ref<SaveStatus>("saved");
  const savedAt = ref<number | null>(null);

  saver.onStatus((s) => {
    status.value = s;
    if (s === "saved") savedAt.value = Date.now();
  });

  async function saveNow() {
    await saver.flush();
    if (status.value === "saved") savedAt.value = Date.now();
  }

  // 한글 입력 상태에서는 key가 'ㄴ'으로 오므로 자판 위치(code)로 본다
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.code === "KeyS") {
      event.preventDefault();
      void saveNow();
    }
  });

  return { status, savedAt, saveNow };
}
