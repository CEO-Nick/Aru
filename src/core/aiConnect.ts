import type { Os } from "../platform/os";

export type AiTool = "claude-code" | "codex";

// 빈칸·따옴표가 있는 경로도 터미널에 그대로 붙여넣을 수 있게 감싼다
function shellQuote(path: string): string {
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`;
}

// PowerShell은 작은따옴표를, cmd는 큰따옴표만 알아듣는다. 둘 다에서 되는 건 큰따옴표다
const windowsQuote = (path: string) => `"${path.replaceAll('"', '\\"')}"`;

/** 붙여넣으면 그 AI 도구에 Aru를 MCP 서버로 등록하는 명령 */
export function connectCommand(tool: AiTool, aru: string, os: Os = "macos"): string {
  const server = `${os === "windows" ? windowsQuote(aru) : shellQuote(aru)} mcp`;
  return tool === "claude-code" ? `claude mcp add --scope user aru -- ${server}` : `codex mcp add aru -- ${server}`;
}
