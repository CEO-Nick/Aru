import { describe, expect, it } from "vitest";
import { mergeContent } from "./merge";
import { mergeTodoContent } from "./todoFile";

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

describe("UI-10: 한쪽은 체크만, 다른 쪽은 글자를 고친 같은 줄", () => {
  it("저쪽이 체크하고 내가 글자를 고쳤으면 한 항목으로 합친다", () => {
    expect(mergeContent("- [ ] 장보기\n", "- [ ] 장보기 우유\n", "- [x] 장보기\n")).toBe("- [x] 장보기 우유\n");
  });

  it("내가 체크하고 저쪽이 글자를 고쳤어도 한 항목으로 합친다", () => {
    expect(mergeContent(base, "- [x] 하나\n- [ ] 둘\n", "- [ ] 하나 더\n- [ ] 둘\n")).toBe("- [x] 하나 더\n- [ ] 둘\n");
  });

  it("주변 줄이 함께 바뀌어도 체크와 글자 수정을 합친다", () => {
    const mine = "- [ ] 하나 고침\n- [ ] 둘\n- [ ] 셋\n";
    const theirs = "- [x] 하나\n- [ ] 둘\n";
    expect(mergeContent(base, mine, theirs)).toBe("- [x] 하나 고침\n- [ ] 둘\n- [ ] 셋\n");
  });
});

describe("QA2-08: 옮겨진 줄과 같은 글자 줄", () => {
  it("내가 체크해서 아래로 옮긴 줄을 저쪽이 글자만 고쳤으면 한 줄로 합친다", () => {
    const base = "- [ ] a\n- [ ] b\n- [ ] c\n";
    const mine = "- [ ] b\n- [ ] c\n- [x] a\n";
    const theirs = "- [ ] a 우유\n- [ ] b\n- [ ] c\n";
    expect(mergeContent(base, mine, theirs)).toBe("- [ ] b\n- [ ] c\n- [x] a 우유\n");
  });

  it("저쪽이 체크해서 옮긴 줄을 내가 글자만 고쳤어도 한 줄로 합친다", () => {
    const base = "- [ ] a\n- [ ] b\n";
    const mine = "- [ ] a!\n- [ ] b\n";
    const theirs = "- [ ] b\n- [x] a\n";
    expect(mergeContent(base, mine, theirs)).toBe("- [x] a!\n- [ ] b\n");
  });

  it("같은 글자 줄이 둘이면 원래 자리가 같은 줄끼리 짝짓는다", () => {
    const base = "- [ ] 회의\n- [ ] 메일\n- [ ] 회의\n";
    const mine = "- [x] 회의\n- [ ] 메일\n- [ ] 회의\n";
    const theirs = "- [ ] 회의\n- [ ] 메일\n- [ ] 회의 2시\n";
    expect(mergeContent(base, mine, theirs)).toBe("- [x] 회의\n- [ ] 메일\n- [ ] 회의 2시\n");
  });

  it("같은 글자 줄 중 저쪽이 지운 것은 원래 자리의 줄을 지운다", () => {
    const base = "- [ ] x\n- [ ] 가\n- [ ] x\n";
    const mine = "- [ ] x 고침\n- [ ] 가\n- [ ] x\n- [ ] 새\n";
    const theirs = "- [ ] x\n- [ ] 가\n";
    expect(mergeContent(base, mine, theirs)).toBe("- [ ] x 고침\n- [ ] 가\n- [ ] 새\n");
  });

  it("아주 긴 파일 전체가 재배치돼도 짝 찾기를 건너뛰어 금방 끝난다(제곱 메모리 없음)", () => {
    const N = 10000;
    const lines = Array.from({ length: N }, (_, i) => `- [ ] item ${i}`);
    const mine = [...lines.slice(1), lines[0]];
    const theirs = [...lines];
    theirs[N / 2] = `- [x] item ${N / 2}`;
    const started = performance.now();
    const out = mergeContent(`${lines.join("\n")}\n`, `${mine.join("\n")}\n`, `${theirs.join("\n")}\n`);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(out.split("\n").length).toBe(N + 1);
    expect(out).toContain(`- [x] item ${N / 2}\n`);
  });
});

describe("라운드 3: 줄 끝만 바뀐 줄, 내가 넣은 줄 표시 (QA3-02·QA3-05·리뷰 LOW)", () => {
  it("저쪽이 파일 전체를 CRLF로 바꿔도 같은 줄로 보고, 줄 끝은 지금 파일(저쪽)을 따른다", () => {
    const r = mergeTodoContent("- [ ] a\n- [ ] b\n- [ ] c\n", "- [ ] a\n- [x] b\n- [ ] c\n", "- [ ] a\r\n- [ ] b\r\n- [ ] c\r\n");
    expect(r).toBe("- [ ] a\r\n- [x] b\r\n- [ ] c\r\n");
  });

  it("CRLF로 바꾸며 줄을 더해도 합치고, 새 줄도 많은 쪽 줄 끝을 쓴다", () => {
    expect(mergeTodoContent("- [ ] a\n- [ ] b\n", "- [ ] a\n- [x] b\n", "- [ ] a\r\n- [ ] b\r\n- [ ] d\r\n")).toBe(
      "- [ ] a\r\n- [x] b\r\n- [ ] d\r\n",
    );
    expect(mergeTodoContent("- [ ] a\n", "- [ ] a\n- [ ] 내 줄\n", "- [ ] a\r\n- [ ] d\r\n")).toBe("- [ ] a\r\n- [ ] 내 줄\r\n- [ ] d\r\n");
  });

  it("반대로 CRLF 파일을 LF로 바꿔도 같다", () => {
    expect(mergeTodoContent("- [ ] a\r\n- [ ] b\r\n", "- [ ] a\r\n- [x] b\r\n", "- [ ] a\n- [ ] b\n- [ ] d\n")).toBe(
      "- [ ] a\n- [x] b\n- [ ] d\n",
    );
  });

  it("한 줄만 줄 끝이 바뀌어도 둘이 되지 않는다. 있던 줄은 지금 파일의 줄 끝을 지닌다", () => {
    expect(mergeTodoContent("- [ ] a\n- [ ] b\n", "- [x] a\n- [ ] b\n", "- [ ] a\r\n- [ ] b\n")).toBe("- [x] a\n- [ ] b\n");
    expect(mergeTodoContent("- [ ] a\n- [ ] b\n- [ ] c\n", "- [ ] a\n- [ ] b\n- [x] c\n", "- [ ] a\n- [ ] b\r\n- [ ] c\n")).toBe(
      "- [ ] a\n- [ ] b\r\n- [x] c\n",
    );
  });

  it("저쪽이 BOM만 붙였어도 첫 줄을 다른 줄로 보지 않는다", () => {
    expect(mergeTodoContent("- [ ] a\n- [ ] b\n", "- [x] a\n- [ ] b\n", "﻿- [ ] a\n- [ ] b\n")).toBe("﻿- [x] a\n- [ ] b\n");
  });

  it("합집합(폴더 바꾸기): 두 쪽에 같은 제목이 있으면 제목은 하나, 저쪽 할 일도 제목 아래로 간다", () => {
    expect(mergeTodoContent("", "# 10월 14일\n- [ ] 옛 폴더 일 고침\n", "# 10월 14일\n- [ ] 새 폴더 일\n")).toBe(
      "# 10월 14일\n- [ ] 옛 폴더 일 고침\n- [ ] 새 폴더 일\n",
    );
  });

  it("저쪽이 넣은 빈 줄·소제목은 내 쪽 다른 곳에 같은 글자의 줄이 있어도(내가 넣은 줄이 아니면) 빠지지 않는다", () => {
    const base = "## 오전\n- [ ] a\n";
    const mine = "## 오전\n- [x] a\n";
    const theirs = "## 오전\n- [ ] a\n## 오전\n- [ ] b\n";
    expect(mergeContent(base, mine, theirs)).toBe("## 오전\n- [x] a\n## 오전\n- [ ] b\n");
  });

  it("저쪽이 넣은 줄은 내가 고친 줄 뒤로 밀리지 않는다 — 건너뛰는 것은 내가 새로 넣은 줄뿐이다", () => {
    const base = "- [ ] a\n- [ ] b\n";
    const mine = "- [ ] a\n- [ ] b 고침\n";
    const theirs = "- [ ] a\n- [ ] 저쪽\n- [ ] b\n";
    expect(mergeContent(base, mine, theirs)).toBe("- [ ] a\n- [ ] 저쪽\n- [ ] b 고침\n");
  });

  it("내가 이미 넣은 줄이 저쪽에서 되돌아오면(같은 글자) 한 번만 남는다", () => {
    expect(mergeContent("- [ ] a\n", "- [ ] a\n- [ ] 새 일\n", "- [ ] a\n- [ ] 새 일\n- [ ] 저쪽\n")).toBe("- [ ] a\n- [ ] 새 일\n- [ ] 저쪽\n");
  });

  // M1·M2: 정한 정책을 테스트로 남긴다
  it("M1: 저쪽이 이미 있는(손대지 않은) 줄과 같은 줄을 하나 더 넣었으면 그대로 둘이 된다 — 저쪽이 일부러 넣은 줄이다", () => {
    expect(mergeContent("- [ ] 물\n- [ ] 운동\n", "- [ ] 물\n- [x] 운동\n", "- [ ] 물\n- [ ] 운동\n- [ ] 물\n")).toBe(
      "- [ ] 물\n- [x] 운동\n- [ ] 물\n",
    );
  });

  it("M2: 저쪽은 지우고 나는 체크(또는 고침)한 줄은 내 쪽대로 남는다 — 마지막에 손댄 사람의 뜻을 지운 쪽보다 앞세운다", () => {
    expect(mergeContent("- [ ] X\n- [ ] Y\n", "- [ ] Y\n- [x] X\n", "- [ ] Y\n")).toBe("- [ ] Y\n- [x] X\n");
    expect(mergeContent("- [ ] X\n- [ ] Y\n", "- [ ] X2\n- [ ] Y\n", "- [ ] Y\n")).toBe("- [ ] X2\n- [ ] Y\n");
  });
});
