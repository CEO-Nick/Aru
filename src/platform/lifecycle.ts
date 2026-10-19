import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * 종료 요청(앱 메뉴 "종료", Cmd+Q, Dock "종료")이 오면 저장을 마치고 준비됐다고 알린다.
 * 열린 창이 모두 준비되면(또는 11초가 지나면) 앱이 꺼진다. 폴더를 옮기는 중이면 그게 끝난 뒤(최대 60초)에야 이 요청이 온다
 */
export const onQuitRequested = (flush: () => Promise<unknown>) => listen("quit-requested", () => readyToQuit(flush));

/**
 * 저장을 마치고 종료 준비됐다고 알린다. 폴더를 바꿔 새로고침된 창도 부른다 — 종료가 폴더 옮기기를 기다렸다면
 * quit-requested가 새 페이지가 듣기 전에 와서 놓친다. Rust의 quit_ready는 종료 중이 아니면 아무것도 하지 않는다
 */
export async function readyToQuit(flush: () => Promise<unknown>) {
  try {
    await flush();
  } finally {
    await invoke("quit_ready");
  }
}

/** 종료를 눌렀지만 폴더 옮기기가 끝나기를 기다리는 중이다(Rust가 quit-requested 전에 보낸다) */
export const onQuitWaiting = (cb: () => void) => listen("quit-waiting", () => cb());
