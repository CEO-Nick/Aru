import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { WindowControl } from "./windowControl";

export const tauriWindow: WindowControl = {
  setOpacity: (alpha) => invoke("set_window_opacity", { alpha }),
  setAlwaysOnTop: (on) => getCurrentWindow().setAlwaysOnTop(on),
};
