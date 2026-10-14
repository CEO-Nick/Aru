import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

export interface FileChanged {
  path: string;
  source: string;
}

export const onFileChanged = (cb: (e: FileChanged) => void) =>
  listen<FileChanged>("file-changed", (event) => cb(event.payload));

/** 모아보기 창에서 고른 날짜를 작은 창에 띄운다 */
export const showDateInMain = (date: string) => emit("show-date", date);
export const onShowDate = (cb: (date: string) => void) =>
  listen<string>("show-date", (event) => cb(event.payload));

export const openOverview = (date?: string) => invoke("open_overview", { date });

export const onSelectDate = (cb: (date: string) => void) =>
  listen<string>("select-date", (event) => cb(event.payload));
