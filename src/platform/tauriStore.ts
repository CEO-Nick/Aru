import { invoke } from "@tauri-apps/api/core";
import type { FileStore, WriteIfResult } from "./fileStore";

export const tauriStore: FileStore = {
  read: (path) => invoke<string | null>("read_text", { path }),
  write: (path, content) => invoke("write_text", { path, content }),
  writeIf: (path, content, expected) => invoke<WriteIfResult>("write_text_if", { path, content, expected }),
};
