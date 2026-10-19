import { describe, expect, it } from "vitest";
import { addDays } from "./date";
import { carryOver, datesBetween, MAX_CATCH_UP_DAYS } from "./rollover";
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

describe("UI-15: 따라잡는 날 수 상한", () => {
  it("아주 오래 꺼져 있었어도 오늘 전 MAX_CATCH_UP_DAYS일까지만 돌려준다", () => {
    const dates = datesBetween("2000-01-01", "2026-10-15");
    expect(dates.length).toBe(MAX_CATCH_UP_DAYS);
    expect(dates.at(-1)).toBe("2026-10-14");
    expect(dates[0]).toBe(addDays("2026-10-15", -MAX_CATCH_UP_DAYS));
  });

  it("날짜 형식이 아니면 빈 목록이다", () => {
    expect(datesBetween("0000-00-00", "2026-10-15")).toEqual([]);
  });
});

describe("carryOver: 빈 칸 할 일 (QA6-02)", () => {
  const past = [{ date: "2026-10-13", items: [t("a", "할 일"), t("b", "\u3164"), t("c", "끝", true)] }];

  it("'다음 날로'면 눈에 빈 할 일은 옮기지 않고 그날에 그대로 둔다", () => {
    const result = carryOver("next-day", past, [], []);
    expect(result.today.map((i) => i.text)).toEqual(["할 일"]);
    expect(result.pastDays[0].items.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("'언젠가로'도 같다", () => {
    const result = carryOver("someday", past, [], []);
    expect(result.someday.map((i) => i.text)).toEqual(["할 일"]);
    expect(result.pastDays[0].items.map((i) => i.id)).toEqual(["b", "c"]);
  });
});
