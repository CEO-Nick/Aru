import { describe, expect, it } from "vitest";
import { addDays, toIsoDate } from "./date";

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
