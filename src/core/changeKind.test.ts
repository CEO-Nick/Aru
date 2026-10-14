import { describe, expect, it } from "vitest";
import { saveModeFor } from "./changeKind";
import type { TodoItem } from "./todoList";

const a: TodoItem = { id: "a", text: "하나", done: false };
const b: TodoItem = { id: "b", text: "둘", done: false };

describe("saveModeFor", () => {
  it("글자만 바뀌었으면 입력 중이므로 기다렸다 저장한다", () => {
    expect(saveModeFor([a, b], [a, { ...b, text: "둘!" }])).toBe("debounce");
  });

  it("체크가 바뀌면 바로 저장한다", () => {
    expect(saveModeFor([a, b], [a, { ...b, done: true }])).toBe("now");
  });

  it("추가·삭제·순서 변경은 바로 저장한다", () => {
    expect(saveModeFor([a], [a, b])).toBe("now");
    expect(saveModeFor([a, b], [a])).toBe("now");
    expect(saveModeFor([a, b], [b, a])).toBe("now");
  });

  it("넘어온 날짜 꼬리표를 지우면 바로 저장한다", () => {
    expect(saveModeFor([{ ...a, from: "2026-10-12" }], [a])).toBe("now");
  });
});
