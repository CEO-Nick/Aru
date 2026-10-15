import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

const FEEDBACK_FORM = "https://tally.so/r/laDqkN";

/** 피드백 폼을 브라우저로 연다. 어느 버전에서 생긴 일인지 다시 묻지 않도록 버전을 채워 보낸다 */
export async function openFeedback() {
  const url = new URL(FEEDBACK_FORM);
  url.searchParams.set("version", await getVersion());
  url.searchParams.set("os", await invoke<string>("os_version").catch(() => "macOS"));
  await openUrl(url.toString());
}
