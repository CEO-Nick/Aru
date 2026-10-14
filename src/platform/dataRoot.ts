import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

export const getDataRoot = () => invoke<string>("get_data_root");

/** 폴더를 고르게 하고 저장 폴더로 바꾼다. 취소하면 false */
export async function pickDataRoot(): Promise<boolean> {
  const picked = await open({ directory: true, multiple: false, title: "할 일을 저장할 폴더" });
  if (typeof picked !== "string") return false;
  await invoke("set_data_root", { path: picked });
  return true;
}

export const revealDataRoot = async () => revealItemInDir(await getDataRoot());

export const onDataRootChanged = (cb: () => void) => listen("data-root-changed", cb);
