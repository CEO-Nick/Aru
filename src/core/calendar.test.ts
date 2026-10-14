import { describe, expect, it } from "vitest";
import { addMonths, monthGrid, monthLabel, monthSummary } from "./calendar";

describe("monthGrid", () => {
  it("월요일부터 시작하는 주 단위 칸을 만든다 (앞뒤 달 날짜 포함)", () => {
    const grid = monthGrid("2026-10");
    expect(grid[0]).toBe("2026-09-28");
    expect(grid.at(-1)).toBe("2026-11-01");
    expect(grid).toHaveLength(35);
  });

  it("6주가 필요한 달은 42칸이다", () => {
    expect(monthGrid("2026-08")).toHaveLength(42);
  });
});

describe("addMonths / monthLabel", () => {
  it("연도를 넘어 달을 이동한다", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("'2026년 10월'로 보여준다", () => {
    expect(monthLabel("2026-10")).toBe("2026년 10월");
  });
});

describe("monthSummary", () => {
  it("그 달에 속한 날짜의 완료·미완료 개수만 센다", () => {
    const items = {
      "2026-09-30": [{ id: "x", text: "지난달", done: false }],
      "2026-10-01": [
        { id: "a", text: "하나", done: true },
        { id: "b", text: "둘", done: false },
      ],
      "2026-10-20": [{ id: "c", text: "셋", done: false }],
    };
    expect(monthSummary("2026-10", items)).toEqual({ done: 1, pending: 2 });
  });
});
