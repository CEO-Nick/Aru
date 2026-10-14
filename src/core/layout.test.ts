import { describe, expect, it } from "vitest";
import { splitRatio } from "./layout";

describe("splitRatio", () => {
  it("손잡이 위치를 전체 높이에 대한 위쪽 영역 비율로 바꾼다", () => {
    expect(splitRatio(250, 100, 300)).toBeCloseTo(0.5);
  });

  it("어느 한쪽이 너무 작아지지 않게 0.2~0.8로 자른다", () => {
    expect(splitRatio(100, 100, 300)).toBeCloseTo(0.2);
    expect(splitRatio(400, 100, 300)).toBeCloseTo(0.8);
  });
});
