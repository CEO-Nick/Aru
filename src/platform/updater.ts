import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** 앱이 이미 찾아 둔 새 버전. 창이 열리기 전에 찾았을 수 있어서 열릴 때 한 번 묻는다 */
export const pendingUpdate = () => invoke<string | null>("pending_update");

export const onUpdateAvailable = (cb: (version: string) => void) =>
  listen<string>("update-available", (event) => cb(event.payload));

/** 내려받아 설치한 뒤, 열린 창들의 저장을 마치고 새 버전으로 다시 켠다 */
export const installUpdate = () => invoke("install_update");
