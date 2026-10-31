import { invoke } from "@tauri-apps/api/core";

export type Os = "macos" | "windows" | "linux";

const KNOWN: readonly string[] = ["macos", "windows", "linux"];

let current: Os = "macos";
let resolving: Promise<Os> | undefined;

/** 이 앱이 도는 OS. resolveOs()가 끝나기 전에는 macos다 */
export const currentOs = (): Os => current;

// platform_info가 없는 앱(Rust가 아직 구현하기 전 버전)에서도 Windows 문구가 나오게 WebView 이름으로 짐작한다
const guess = (): Os => (navigator.userAgent.includes("Windows") ? "windows" : "macos");

/** Rust에 OS를 한 번 묻고 기억한다. 실패하지 않는다 */
export function resolveOs(): Promise<Os> {
  resolving ??= invoke<{ os?: string }>("platform_info")
    .then((info) => (KNOWN.includes(info?.os ?? "") ? (info.os as Os) : guess()))
    .catch(guess)
    .then((os) => (current = os));
  return resolving;
}
