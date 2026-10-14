import { describe, expect, it } from "vitest";
import { carryOver, datesBetween } from "./rollover";
import type { TodoItem } from "./todoList";

const t = (id: string, text: string, done = false, from?: string): TodoItem =>
  from ? { id, text, done, from } : { id, text, done };

describe("datesBetween", () => {
  it("시작일부터 끝 날짜 전날까지를 돌려준다", () => {
    expect(datesBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("같은 날이거나 거꾸로면 빈 목록이다", () => {
    expect(datesBetween("2026-10-14", "2026-10-14")).toEqual([]);
    expect(datesBetween("2026-10-15", "2026-10-14")).toEqual([]);
  });
});

describe("carryOver", () => {
  const past = [{ date: "2026-10-13", items: [t("a", "회의", true), t("b", "PR 리뷰")] }];

  it("'그대로 남기기'면 아무것도 옮기지 않는다", () => {
    const result = carryOver("keep", past, [], []);
    expect(result.pastDays).toEqual(past);
    expect(result.today).toEqual([]);
    expect(result.someday).toEqual([]);
  });

  it("'다음 날로'면 미완료만 오늘로 옮기고 원래 날짜를 꼬리표로 붙인다. 완료한 건 남는다", () => {
    const result = carryOver("next-day", past, [], []);
    expect(result.pastDays).toEqual([{ date: "2026-10-13", items: [t("a", "회의", true)] }]);
    expect(result.today).toEqual([t("b", "PR 리뷰", false, "2026-10-13")]);
  });

  it("미리 등록해 둔 오늘 항목이 있으면 옮겨온 항목은 그 아래에 붙는다", () => {
    const result = carryOver("next-day", past, [t("x", "치과")], []);
    expect(result.today.map((i) => i.text)).toEqual(["치과", "PR 리뷰"]);
  });

  it("며칠을 거쳐 넘어온 항목은 처음 날짜를 유지한다", () => {
    const old = [{ date: "2026-10-13", items: [t("b", "PR 리뷰", false, "2026-10-10")] }];
    expect(carryOver("next-day", old, [], []).today[0].from).toBe("2026-10-10");
  });

  it("여러 날을 한 번에 처리하면 오래된 날 것부터 붙는다", () => {
    const days = [
      { date: "2026-10-11", items: [t("p", "오래된 일")] },
      { date: "2026-10-12", items: [t("q", "어제 일")] },
    ];
    expect(carryOver("next-day", days, [], []).today.map((i) => i.text)).toEqual(["오래된 일", "어제 일"]);
  });

  it("'언젠가로'면 미완료를 언젠가 목록 맨 끝으로 옮긴다", () => {
    const result = carryOver("someday", past, [], [t("s", "여권")]);
    expect(result.today).toEqual([]);
    expect(result.someday).toEqual([t("s", "여권"), t("b", "PR 리뷰", false, "2026-10-13")]);
    expect(result.pastDays[0].items).toEqual([t("a", "회의", true)]);
  });
});
