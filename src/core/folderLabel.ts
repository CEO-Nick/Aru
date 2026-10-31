import type { Os } from "../platform/os";

export interface DataRootInfo {
  path: string;
  /** 사용자가 폴더를 고르지 않아 앱 기본 폴더를 쓰는 중 */
  isDefault: boolean;
  /** 사용자 홈 폴더. 샌드박스에서도 컨테이너가 아닌 진짜 홈이다 */
  home: string;
}

export const DEFAULT_FOLDER_LABEL = "기본 폴더 (Aru 안)";

const ICLOUD = "~/Library/Mobile Documents/com~apple~CloudDocs";
const ONEDRIVE = "~\\OneDrive";

/** 설정에 보일 저장 폴더 이름. 전체 경로는 title로 남긴다 */
export function folderLabel({ path, isDefault, home }: DataRootInfo, os: Os = "macos"): { label: string; title: string } {
  const win = os === "windows";
  // 맥 기본 폴더는 앱 컨테이너 안이라 이름만 보인다. Windows 기본 폴더는 문서 아래 Aru라 사용자가 찾아갈 수 있게 위치를 보인다
  if (isDefault && !win) return { label: DEFAULT_FOLDER_LABEL, title: path };
  if (isDefault) return { label: `기본 폴더 (${folderLabel({ path, isDefault: false, home }, os).label})`, title: path };
  // Windows는 /도 구분자로 받는다(폴더 고르기 창이 섞어 돌려줄 수 있다)
  const sep = win ? "\\" : "/";
  const norm = (p: string) => (win ? p.replaceAll("/", "\\") : p);
  const cloud = win ? ONEDRIVE : ICLOUD;
  const cloudName = win ? "OneDrive" : "iCloud Drive";

  const full = norm(path);
  const base = norm(home).replace(win ? /\\+$/ : /\/+$/, "");
  let label = full;
  if (base && (full === base || full.startsWith(`${base}${sep}`))) label = `~${full.slice(base.length)}`;
  if (label === cloud || label.startsWith(`${cloud}${sep}`)) label = `${cloudName}${label.slice(cloud.length)}`;
  return { label, title: path };
}
