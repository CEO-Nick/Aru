import { describe, expect, it } from "vitest";
import { addDays, inDateRange, isIsoDate, msUntilNextMidnight, toIsoDate } from "./date";

describe("msUntilNextMidnight", () => {
  it("다음 자정까지 남은 시간을 현지 시각 기준으로 잰다", () => {
    expect(msUntilNextMidnight(new Date(2026, 9, 14, 23, 59, 30))).toBe(30_000);
    expect(msUntilNextMidnight(new Date(2026, 9, 14, 0, 0, 0))).toBe(24 * 3600_000);
  });
});

describe("addDays", () => {
  it("월말·연말을 넘어 날짜를 더하고 뺀다", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("toIsoDate", () => {
  it("현지 시각 기준 날짜를 YYYY-MM-DD로 만든다", () => {
    expect(toIsoDate(new Date(2026, 9, 4, 23, 59))).toBe("2026-10-04");
  });
});

describe("addDays: 네 자리 연도", () => {
  it("100년 이전 날짜도 연도를 네 자리로 쓰고 1900년대로 튀지 않는다", () => {
    expect(addDays("0100-01-01", -1)).toBe("0099-12-31");
    expect(addDays("0099-12-31", -1)).toBe("0099-12-30");
  });
});

describe("isIsoDate", () => {
  it("달력에 있는 YYYY-MM-DD만 참이다", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-45")).toBe(false);
    expect(isIsoDate("0000-00-00")).toBe(false);
    expect(isIsoDate("어제")).toBe(false);
  });
});

describe("inDateRange (리뷰 r7 N5)", () => {
  it("달력에 없는 날짜는 범위 안 모양이어도 거른다", () => {
    expect(inDateRange("2026-02-31")).toBe(false);
    expect(inDateRange("2026-13-01")).toBe(false);
    expect(inDateRange("2026-02-28")).toBe(true);
    expect(inDateRange("9999-12-31")).toBe(true);
    expect(inDateRange("1969-12-31")).toBe(false);
  });
});
