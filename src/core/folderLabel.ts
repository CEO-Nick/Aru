export interface DataRootInfo {
  path: string;
  /** 사용자가 폴더를 고르지 않아 앱 기본 폴더를 쓰는 중 */
  isDefault: boolean;
  /** 사용자 홈 폴더. 샌드박스에서도 컨테이너가 아닌 진짜 홈이다 */
  home: string;
}

export const DEFAULT_FOLDER_LABEL = "기본 폴더 (Aru 안)";

const ICLOUD = "~/Library/Mobile Documents/com~apple~CloudDocs";

/** 설정에 보일 저장 폴더 이름. 전체 경로는 title로 남긴다 */
export function folderLabel({ path, isDefault, home }: DataRootInfo): { label: string; title: string } {
  if (isDefault) return { label: DEFAULT_FOLDER_LABEL, title: path };
  const base = home.replace(/\/+$/, "");
  let label = path;
  if (base && (path === base || path.startsWith(`${base}/`))) label = `~${path.slice(base.length)}`;
  if (label === ICLOUD || label.startsWith(`${ICLOUD}/`)) label = `iCloud Drive${label.slice(ICLOUD.length)}`;
  return { label, title: path };
}
