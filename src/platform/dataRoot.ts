import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { DataRootInfo } from "../core/folderLabel";

export const getDataRoot = () => invoke<string>("get_data_root");

/** 설정에 보일 저장 폴더: 경로, 기본 폴더인지, 사용자 홈 폴더 */
export const dataRootInfo = () => invoke<DataRootInfo>("data_root_info");

/** 고른 저장 폴더를 지금 열 수 있는가. 외장 디스크가 빠졌거나 iCloud가 아직 붙지 않았으면 ok가 false */
export interface DataRootStatus {
  ok: boolean;
  path: string;
  error?: string | null;
}

export const dataRootStatus = () => invoke<DataRootStatus | null>("data_root_status");

/**
 * 폴더를 바꾼 결과. copied가 false면 지금 할 일을 새 폴더로 옮기지 않았다.
 * reason — copied: 옮겼다, kept: 이미 할 일이 있는 폴더라 두었다, sourceUnavailable: 지금 폴더를 열 수 없어 옮길 게 없었다
 */
export interface RootChanged {
  copied: boolean;
  reason: "copied" | "kept" | "sourceUnavailable";
}

/** 기본 저장 폴더로 되돌린다. 바뀌면 data-root-changed가 온다 */
export const resetDataRoot = () => invoke("reset_data_root");

/** 폴더를 고르게 하고 저장 폴더로 바꾼다. 취소하면 null. 바꾸지 못하면 그 이유로 실패한다 */
export async function pickDataRoot(): Promise<RootChanged | null> {
  const picked = await open({ directory: true, multiple: false, title: "할 일을 저장할 폴더" });
  if (typeof picked !== "string") return null;
  return invoke<RootChanged>("set_data_root", { path: picked });
}

export const revealDataRoot = async () => revealItemInDir(await getDataRoot());

/** 기본 폴더로 되돌렸으면 내용이 없다(null) */
export const onDataRootChanged = (cb: (changed: RootChanged | null) => void) =>
  listen<RootChanged | null>("data-root-changed", (e) => cb(e.payload ?? null));
