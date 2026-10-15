import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** 새 버전과, 배포할 때 적어 둔 바뀐 점 */
export interface UpdateInfo {
  version: string;
  notes: string;
}

/** 앱이 이미 찾아 둔 새 버전. 창이 열리기 전에 찾았을 수 있어서 열릴 때 한 번 묻는다 */
export const pendingUpdate = () => invoke<UpdateInfo | null>("pending_update");

export const onUpdateAvailable = (cb: (update: UpdateInfo) => void) =>
  listen<UpdateInfo>("update-available", (event) => cb(event.payload));

/** 내려받아 설치한 뒤, 열린 창들의 저장을 마치고 새 버전으로 다시 켠다 */
export const installUpdate = () => invoke("install_update");

/** 지금 바로 GitHub에 새 버전이 있는지 묻는다 */
export const checkUpdateNow = () => invoke<UpdateInfo | null>("check_update_now");
