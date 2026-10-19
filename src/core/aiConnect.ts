export type AiTool = "claude-code" | "codex";

// 빈칸·따옴표가 있는 경로도 터미널에 그대로 붙여넣을 수 있게 감싼다
function shellQuote(path: string): string {
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`;
}

/** 붙여넣으면 그 AI 도구에 Aru를 MCP 서버로 등록하는 명령 */
export function connectCommand(tool: AiTool, aru: string): string {
  const server = `${shellQuote(aru)} mcp`;
  return tool === "claude-code" ? `claude mcp add --scope user aru -- ${server}` : `codex mcp add aru -- ${server}`;
}
