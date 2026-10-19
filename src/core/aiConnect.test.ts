import { describe, expect, it } from "vitest";
import { connectCommand } from "./aiConnect";

const ARU = "/Applications/Aru.app/Contents/MacOS/aru";

describe("connectCommand", () => {
  it("도구마다 등록 명령을 만든다", () => {
    expect(connectCommand("claude-code", ARU)).toBe(`claude mcp add --scope user aru -- ${ARU} mcp`);
    expect(connectCommand("codex", ARU)).toBe(`codex mcp add aru -- ${ARU} mcp`);
  });

  it("빈칸이나 따옴표가 있는 경로는 감싼다", () => {
    expect(connectCommand("codex", "/Users/me/My Apps/aru")).toBe("codex mcp add aru -- '/Users/me/My Apps/aru' mcp");
    expect(connectCommand("codex", "/tmp/it's/aru")).toBe(`codex mcp add aru -- '/tmp/it'\\''s/aru' mcp`);
  });
});
