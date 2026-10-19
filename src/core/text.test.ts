import { describe, expect, it } from "vitest";
import { isBlankTodoText } from "./text";

// aru 명령(Rust)과 똑같이 맞춘 목록. 하나라도 빠지면 두 쪽 판정이 갈린다
const INVISIBLE_POINTS = [
  0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180c, 0x180d, 0x180e, 0x180f,
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069, 0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f,
  0x2800, 0x3164, 0xfe00, 0xfe0f, 0xfeff, 0xffa0, 0x1d159, 0x1d173, 0x1d17a, 0xe0000, 0xe0020, 0xe007f, 0xe0100, 0xe01ef,
];
// Unicode White_Space 전부
const WHITE_SPACE = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2005, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
];

describe("isBlankTodoText (aru 명령과 같은 계약)", () => {
  it.each(INVISIBLE_POINTS.map((p) => [p.toString(16)]))("U+%s만 있으면 빈 글이다", (hex) => {
    const ch = String.fromCodePoint(parseInt(hex, 16));
    expect(isBlankTodoText(ch)).toBe(true);
    expect(isBlankTodoText(` ${ch}${ch} `)).toBe(true);
  });

  it("Unicode 공백 문자만 있으면 빈 글이다", () => {
    expect(isBlankTodoText(WHITE_SPACE.map((p) => String.fromCodePoint(p)).join(""))).toBe(true);
    expect(isBlankTodoText("")).toBe(true);
  });

  it("보이는 글자가 하나라도 있으면 빈 글이 아니다", () => {
    expect(isBlankTodoText("​가")).toBe(false);
    expect(isBlankTodoText("a­")).toBe(false);
    // 목록 바로 바깥의 이웃 글자는 보이는 글자다
    for (const p of [0x180a, 0x2065, 0xfe10, 0x1d158, 0x1d17b, 0xe0080, 0xe01f0, 0x3165]) {
      expect(isBlankTodoText(String.fromCodePoint(p))).toBe(false);
    }
    // 이모지 속 ZWJ·VS는 글자 일부다
    expect(isBlankTodoText("👨‍👩‍👧")).toBe(false);
    expect(isBlankTodoText("❤️")).toBe(false);
  });
});
