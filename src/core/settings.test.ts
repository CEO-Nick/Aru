import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("파일이 없으면 기본값이다", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("저장된 값은 쓰고, 빠진 값은 기본값으로 채운다", () => {
    expect(parseSettings('{"opacity": 40}')).toEqual({ ...DEFAULT_SETTINGS, opacity: 40 });
  });

  it("깨진 파일이면 기본값이다", () => {
    expect(parseSettings("{oops")).toEqual(DEFAULT_SETTINGS);
  });

  it("알 수 없는 미완료 처리 방식은 기본값으로 되돌린다", () => {
    expect(parseSettings('{"carryOver": "???"}').carryOver).toBe(DEFAULT_SETTINGS.carryOver);
  });
});

describe("parseSettings: 이상한 값 바로잡기", () => {
  it("숫자가 아니거나 범위를 벗어난 값은 기본값이나 범위 안으로 고친다", () => {
    const s = parseSettings(
      JSON.stringify({ opacity: "abc", splitRatio: 5, alwaysOnTop: "yes", lastRolloverDate: "어제" }),
    );
    expect(s.opacity).toBe(DEFAULT_SETTINGS.opacity);
    expect(s.splitRatio).toBe(0.8);
    expect(s.alwaysOnTop).toBe(DEFAULT_SETTINGS.alwaysOnTop);
    expect(s.lastRolloverDate).toBeNull();
  });

  it("투명도는 0~100 안으로 자른다", () => {
    expect(parseSettings('{"opacity": 250}').opacity).toBe(100);
    expect(parseSettings('{"opacity": -3}').opacity).toBe(0);
  });

  it("JSON이 객체가 아니면 기본값이다", () => {
    expect(parseSettings("[1,2]")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("null")).toEqual(DEFAULT_SETTINGS);
  });
});

describe("parseSettings: 끝낸 일 아래로 보내기", () => {
  it("기본은 켜짐이고, 저장된 값이 참/거짓이 아니면 기본값이다", () => {
    expect(DEFAULT_SETTINGS.sortChecked).toBe(true);
    expect(parseSettings('{"sortChecked": false}').sortChecked).toBe(false);
    expect(parseSettings('{"sortChecked": "no"}').sortChecked).toBe(true);
  });
});
