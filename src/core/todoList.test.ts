import { describe, expect, it } from "vitest";
import {
  clearFrom,
  acceptAi,
  insertAfter,
  insertAfterOpen,
  removeAiBatch,
  moveBefore,
  settleChecked,
  remove,
  toggle,
  transfer,
  updateText,
} from "./todoList";
import type { TodoItem } from "./todoList";

const a: TodoItem = { id: "a", text: "하나", done: false };
const b: TodoItem = { id: "b", text: "둘", done: true };

describe("toggle", () => {
  it("해당 항목의 완료 여부만 뒤집는다", () => {
    expect(toggle([a, b], "a")).toEqual([{ ...a, done: true }, b]);
  });
});

describe("updateText", () => {
  it("해당 항목의 글자만 바꾼다", () => {
    expect(updateText([a, b], "b", "둘 수정")).toEqual([a, { ...b, text: "둘 수정" }]);
  });
});

describe("insertAfterOpen", () => {
  const open1 = { id: "a", text: "하나", done: false };
  const open2 = { id: "b", text: "둘", done: false };
  const done1 = { id: "x", text: "끝낸 일", done: true };
  const created = { id: "n", text: "새 일", done: false };

  it("남은 일의 맨 끝, 끝낸 일들 바로 위에 넣는다", () => {
    expect(insertAfterOpen([open1, open2, done1], created)).toEqual([open1, open2, created, done1]);
  });

  it("남은 일이 없으면 맨 위에 넣는다", () => {
    expect(insertAfterOpen([done1], created)).toEqual([created, done1]);
  });

  it("끝낸 일이 사이에 섞여 있으면 마지막 남은 일 다음에 넣는다", () => {
    expect(insertAfterOpen([open1, done1, open2], created)).toEqual([open1, done1, open2, created]);
  });
});

describe("insertAfter", () => {
  const c: TodoItem = { id: "c", text: "셋", done: false };

  it("지정한 항목 바로 뒤에 넣는다", () => {
    expect(insertAfter([a, b], "a", c)).toEqual([a, c, b]);
  });

  it("기준 항목이 null이면 맨 끝에 붙인다", () => {
    expect(insertAfter([a, b], null, c)).toEqual([a, b, c]);
  });
});

describe("remove", () => {
  it("해당 항목을 뺀다", () => {
    expect(remove([a, b], "a")).toEqual([b]);
  });
});

describe("moveBefore", () => {
  const c: TodoItem = { id: "c", text: "셋", done: false };

  it("지정한 항목 앞으로 옮긴다", () => {
    expect(moveBefore([a, b, c], "c", "a")).toEqual([c, a, b]);
  });

  it("자기 자신 앞에 놓으면 그대로다", () => {
    expect(moveBefore([a, b, c], "b", "b")).toEqual([a, b, c]);
  });
});

describe("transfer", () => {
  const c: TodoItem = { id: "c", text: "셋", done: false };

  it("원래 목록에서 빼서 대상 목록의 지정한 항목 앞에 넣는다", () => {
    expect(transfer([a, b], [c], "a", "c")).toEqual([[b], [a, c]]);
  });
});

describe("clearFrom", () => {
  it("넘어온 날짜 꼬리표만 지우고 나머지는 그대로 둔다", () => {
    const moved: TodoItem = { id: "m", text: "PR 리뷰", done: false, from: "2026-10-12" };
    expect(clearFrom([a, moved], "m")).toEqual([a, { id: "m", text: "PR 리뷰", done: false }]);
  });
});

describe("settleChecked", () => {
  const t = (id: string, done: boolean): TodoItem => ({ id, text: id, done });
  const ids = (list: TodoItem[]) => list.map((i) => i.id);

  it("체크한 할 일은 남은 일 바로 아래(끝낸 일들의 맨 위)로 간다", () => {
    const list = [t("a", false), t("b", true), t("c", false), t("x", true), t("y", true)];
    expect(ids(settleChecked(list, "b"))).toEqual(["a", "c", "b", "x", "y"]);
  });

  it("체크를 푼 할 일은 남은 일들의 맨 아래로 간다", () => {
    const list = [t("a", false), t("c", false), t("x", true), t("u", false), t("y", true)];
    expect(ids(settleChecked(list, "u"))).toEqual(["a", "c", "u", "x", "y"]);
  });

  it("이미 제자리면 그대로다", () => {
    const list = [t("a", false), t("x", true)];
    expect(settleChecked(list, "x")).toEqual(list);
  });

  it("남은 일이 없으면 맨 위로, 없는 id면 그대로다", () => {
    const list = [t("x", true), t("b", true)];
    expect(ids(settleChecked(list, "b"))).toEqual(["b", "x"]);
    expect(settleChecked(list, "zz")).toEqual(list);
  });
});

describe("AI가 넣은 할 일", () => {
  const ai = { by: "claude-code", at: 100 };
  const fromAi = { id: "a", text: "PR 리뷰", done: false, ai };
  const mine = { id: "b", text: "장보기", done: false };

  it("체크하면 AI 표시가 사라진다", () => {
    expect(toggle([fromAi], "a")).toEqual([{ id: "a", text: "PR 리뷰", done: true }]);
  });

  it("글자를 고치면 AI 표시가 사라지고, 글자가 그대로면 남는다", () => {
    expect(updateText([fromAi], "a", "PR 리뷰 반영")).toEqual([{ id: "a", text: "PR 리뷰 반영", done: false }]);
    expect(updateText([fromAi], "a", "PR 리뷰")).toEqual([fromAi]);
  });

  it("태그를 누르면(acceptAi) 그 할 일만 일반 할 일이 된다", () => {
    expect(acceptAi([fromAi, mine], "a")).toEqual([{ id: "a", text: "PR 리뷰", done: false }, mine]);
  });

  it("묶음 되돌리기는 같은 도구·같은 시각에 넣고 아직 손대지 않은 것만 지운다", () => {
    const other = { id: "c", text: "다른 묶음", done: false, ai: { by: "claude-code", at: 200 } };
    const sibling = { id: "d", text: "같은 묶음", done: false, ai };
    expect(removeAiBatch([fromAi, mine, other, sibling], ai)).toEqual([mine, other]);
  });
});
