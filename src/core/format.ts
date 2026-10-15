function monthDay(isoDate: string): [number, number] {
  const [, month, day] = isoDate.split("-").map(Number);
  return [month, day];
}

export function fromTagLabel(isoDate: string): string {
  const [month, day] = monthDay(isoDate);
  return `${month}/${day}에서 넘어옴`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function dateLabel(isoDate: string): string {
  const [year] = isoDate.split("-").map(Number);
  const [month, day] = monthDay(isoDate);
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()];
  return `${month}월 ${day}일 (${weekday})`;
}

const TOOL_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-ai": "Claude",
  claude: "Claude",
  codex: "Codex",
  "codex-mcp-client": "Codex",
  cursor: "Cursor",
  ai: "AI",
};

/** 할 일을 넣은 AI 도구 이름을 사람이 읽는 이름으로 */
export function toolLabel(by: string): string {
  return TOOL_NAMES[by] ?? by;
}

export function aiTagTitle(ai: { by: string; at: number }): string {
  const d = new Date(ai.at * 1000);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${toolLabel(ai.by)}가 ${time}에 추가 · 누르면 확인`;
}
