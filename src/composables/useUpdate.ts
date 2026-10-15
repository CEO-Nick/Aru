import { getVersion } from "@tauri-apps/api/app";
import { reactive } from "vue";
import { checkUpdateNow, installUpdate, onUpdateAvailable, pendingUpdate, type UpdateInfo } from "../platform/updater";

type InstallState = "idle" | "installing" | "failed";
type CheckState = "idle" | "checking" | "latest" | "failed";

const LAST_VERSION_KEY = "aru.lastVersion";
const UPDATED_NOTICE_MS = 5000;

// 창 아래 버튼과 설정 화면이 같은 상태를 본다. 한쪽에서 설치를 시작하면 다른 쪽도 받는 중으로 바뀐다
const state = reactive({
  current: null as string | null,
  available: null as UpdateInfo | null,
  /** 방금 업데이트돼서 다시 켜졌으면 그 버전. 잠깐 보여 주고 지운다 */
  justUpdated: null as string | null,
  install: "idle" as InstallState,
  check: "idle" as CheckState,
});
let started = false;

/** 배포할 때 적은 "- 항목" 줄들을 목록으로 */
export const noteLines = (notes: string) =>
  notes
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);

function rememberVersion(current: string) {
  try {
    const last = localStorage.getItem(LAST_VERSION_KEY);
    localStorage.setItem(LAST_VERSION_KEY, current);
    if (last && last !== current) {
      state.justUpdated = current;
      setTimeout(() => (state.justUpdated = null), UPDATED_NOTICE_MS);
    }
  } catch {
    // 저장소를 못 쓰면 알림만 건너뛴다
  }
}

async function start() {
  if (started) return;
  started = true;
  onUpdateAvailable((u) => (state.available = u));
  state.available = (await pendingUpdate()) ?? state.available;
  state.current = await getVersion();
  rememberVersion(state.current);
}

async function install() {
  if (state.install === "installing") return;
  state.install = "installing";
  try {
    await installUpdate();
  } catch {
    state.install = "failed";
  }
}

async function check() {
  if (state.check === "checking") return;
  state.check = "checking";
  try {
    const found = await checkUpdateNow();
    if (found) state.available = found;
    state.check = found ? "idle" : "latest";
  } catch {
    state.check = "failed";
  }
}

export function useUpdate() {
  void start();
  return { state, install, check };
}
