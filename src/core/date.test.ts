import { describe, expect, it } from "vitest";
import { addDays, msUntilNextMidnight, toIsoDate } from "./date";

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
