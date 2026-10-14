import { describe, expect, it } from "vitest";
import { sliderToAlpha } from "./opacity";

describe("sliderToAlpha", () => {
  it("슬라이더 0은 창 투명도 0.2다", () => {
    expect(sliderToAlpha(0)).toBeCloseTo(0.2);
  });

  it("슬라이더 100은 창 투명도 1이다", () => {
    expect(sliderToAlpha(100)).toBeCloseTo(1);
  });

  it("슬라이더 50은 창 투명도 0.6이다", () => {
    expect(sliderToAlpha(50)).toBeCloseTo(0.6);
  });

  it("범위를 벗어난 값은 0~100으로 자른다", () => {
    expect(sliderToAlpha(-10)).toBeCloseTo(0.2);
    expect(sliderToAlpha(150)).toBeCloseTo(1);
  });
});
