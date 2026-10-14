import { describe, expect, it } from "vitest";
import { dateLabel, fromTagLabel } from "./format";

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
