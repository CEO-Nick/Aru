import { describe, expect, it } from "vitest";
import { mergeContent } from "./merge";

const base = "- [ ] 하나\n- [ ] 둘\n";

describe("mergeContent", () => {
  it("한쪽만 바뀌었으면 바뀐 쪽을 쓴다", () => {
    expect(mergeContent(base, base, "- [ ] 하나\n")).toBe("- [ ] 하나\n");
    expect(mergeContent(base, "- [x] 하나\n- [ ] 둘\n", base)).toBe("- [x] 하나\n- [ ] 둘\n");
  });

  it("양쪽이 각각 추가한 항목을 모두 남긴다", () => {
    const mine = "- [ ] 하나\n- [ ] 둘\n- [ ] 내가 추가\n";
    const theirs = "- [ ] 하나\n- [ ] 둘\n- [ ] 저쪽이 추가\n";
    expect(mergeContent(base, mine, theirs)).toBe("- [ ] 하나\n- [ ] 둘\n- [ ] 내가 추가\n- [ ] 저쪽이 추가\n");
  });

  it("저쪽이 체크한 것과 내가 고친 글자를 함께 반영한다", () => {
    const mine = "- [ ] 하나!\n- [ ] 둘\n";
    const theirs = "- [ ] 하나\n- [x] 둘\n";
    expect(mergeContent(base, mine, theirs)).toBe("- [ ] 하나!\n- [x] 둘\n");
  });

  it("저쪽이 지운 항목은 내가 건드리지 않았다면 지운다", () => {
    const mine = "- [ ] 하나\n- [ ] 둘\n- [ ] 셋\n";
    const theirs = "- [ ] 둘\n";
    expect(mergeContent(base, mine, theirs)).toBe("- [ ] 둘\n- [ ] 셋\n");
  });

  it("저쪽이 맨 앞에 넣은 항목은 맨 앞에 들어간다", () => {
    const mine = "- [ ] 하나\n- [ ] 둘!\n";
    const theirs = "- [ ] 영\n- [ ] 하나\n- [ ] 둘\n";
    expect(mergeContent(base, mine, theirs)).toBe("- [ ] 영\n- [ ] 하나\n- [ ] 둘!\n");
  });

  it("저쪽이 넣은 줄이 내 쪽에 이미 있으면 두 번 넣지 않는다", () => {
    const mine = "- [ ] 하나\n- [ ] 둘\n- [ ] 셋\n- [ ] 넷\n";
    const theirs = "- [ ] 하나\n- [ ] 둘\n- [ ] 셋\n";
    expect(mergeContent(base, mine, theirs)).toBe(mine);
  });
});
