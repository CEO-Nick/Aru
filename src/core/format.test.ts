import { describe, expect, it } from "vitest";
import { aiTagTitle, dateLabel, fromTagLabel } from "./format";

describe("fromTagLabel", () => {
  it("넘어온 날짜를 월/일 꼬리표로 만든다", () => {
    expect(fromTagLabel("2026-10-02")).toBe("10/2에서 넘어옴");
  });
});

describe("dateLabel", () => {
  it("날짜를 'M월 D일 (요일)'로 보여준다", () => {
    expect(dateLabel("2026-10-14")).toBe("10월 14일 (수)");
    expect(dateLabel("2026-10-18")).toBe("10월 18일 (일)");
  });
});

describe("이상한 표시 정보", () => {
  it("달력에 없는 넘어온 날짜는 0/0 대신 날짜 없이 보여준다", () => {
    expect(fromTagLabel("2026-00-00")).toBe("지난 날에서 넘어옴");
    expect(fromTagLabel("abc")).toBe("지난 날에서 넘어옴");
  });

  it("AI 추가 시각이 이상하면 NaN 대신 시각을 빼고 보여준다", () => {
    expect(aiTagTitle({ by: "codex", at: 1e20 })).toBe("Codex가 추가 · 누르면 확인");
    expect(aiTagTitle({ by: "codex", at: Number.NaN })).toBe("Codex가 추가 · 누르면 확인");
  });
});
