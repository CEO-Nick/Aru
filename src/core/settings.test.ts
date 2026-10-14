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
