import { describe, expect, it } from "vitest";
import {
  clearFrom,
  insertAfter,
  moveBefore,
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
