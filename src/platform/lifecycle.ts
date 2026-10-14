import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * 종료 요청(메뉴 막대 "종료", Cmd+Q)이 오면 저장을 마치고 준비됐다고 알린다.
 * 열린 창이 모두 준비되면(또는 2초가 지나면) 앱이 꺼진다.
 */
export const onQuitRequested = (flush: () => Promise<void>) =>
  listen("quit-requested", async () => {
    try {
      await flush();
    } finally {
      await invoke("quit_ready");
    }
  });
