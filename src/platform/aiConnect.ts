import { invoke } from "@tauri-apps/api/core";

export interface AiConnectInfo {
  /** AI 도구가 실행할 aru 명령의 전체 경로. 앱 실행 파일이 곧 aru 명령이다 */
  command: string;
  /** 이 맥에 Claude 데스크톱이 깔려 있는지 */
  claudeDesktop: boolean;
}

export const aiConnectInfo = () => invoke<AiConnectInfo>("ai_connect_info");

/** Aru 확장 파일을 만들어 Claude 데스크톱으로 연다. 설치 여부는 Claude가 사용자에게 묻는다 */
export const installClaudeDesktop = () => invoke("install_claude_desktop");
