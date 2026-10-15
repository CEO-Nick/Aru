import { describe, expect, it } from "vitest";
import { parseDocument, parseTodos, serializeDocument, serializeTodos } from "./markdown";

describe("serializeDocument", () => {
  it("메모는 할 일 아래에 빈 줄 하나를 두고 쓴다", () => {
    expect(
      serializeDocument({ todos: [{ text: "PR 리뷰", done: true }], notes: "회의 메모" }),
    ).toBe("- [x] PR 리뷰\n\n회의 메모\n");
  });

  it("메모가 없으면 할 일만 쓴다", () => {
    expect(serializeDocument({ todos: [{ text: "하나", done: false }], notes: "" })).toBe(
      "- [ ] 하나\n",
    );
  });

  it("할 일이 없으면 메모만 쓴다", () => {
    expect(serializeDocument({ todos: [], notes: "메모만 있음" })).toBe("메모만 있음\n");
  });

  it("다른 편집기에서 적은 메모는 앱에서 할 일을 체크하고 저장해도 남는다", () => {
    const doc = parseDocument("- [ ] PR 리뷰 반영\n- [x] 스크럼\n\n회의 메모: 배포는 금요일로 미룸\n");
    doc.todos[0].done = true;
    expect(serializeDocument(doc)).toBe(
      "- [x] PR 리뷰 반영\n- [x] 스크럼\n\n회의 메모: 배포는 금요일로 미룸\n",
    );
  });

  it("할 일 사이에 끼어 있던 메모는 할 일 아래로 모인다", () => {
    const doc = parseDocument("- [ ] 하나\n메모\n- [ ] 둘\n");
    expect(serializeDocument(doc)).toBe("- [ ] 하나\n- [ ] 둘\n\n메모\n");
  });
});

describe("parseDocument", () => {
  it("할 일이 아닌 줄은 메모로 모은다", () => {
    expect(parseDocument("- [ ] PR 리뷰\n\n회의 메모: 배포는 금요일\n")).toEqual({
      todos: [{ text: "PR 리뷰", done: false }],
      notes: "회의 메모: 배포는 금요일",
    });
  });

  it("메모의 앞뒤 빈 줄은 정리하고 가운데 빈 줄은 유지한다", () => {
    expect(parseDocument("\n\n메모 하나\n\n메모 둘\n\n").notes).toBe("메모 하나\n\n메모 둘");
  });

  it("할 일만 있으면 메모는 빈 문자열이다", () => {
    expect(parseDocument("- [ ] 하나\n").notes).toBe("");
  });
});

describe("serializeTodos", () => {
  it("빈 목록은 빈 문자열이다", () => {
    expect(serializeTodos([])).toBe("");
  });

  it("미완료와 완료 항목을 한 줄씩 쓰고 마지막에 줄바꿈을 붙인다", () => {
    expect(
      serializeTodos([
        { text: "장보기", done: false },
        { text: "회의", done: true },
      ]),
    ).toBe("- [ ] 장보기\n- [x] 회의\n");
  });

  it("넘어온 날짜는 줄 끝 주석으로 쓴다", () => {
    expect(serializeTodos([{ text: "PR 리뷰", done: false, from: "2026-10-12" }])).toBe(
      "- [ ] PR 리뷰 <!-- from:2026-10-12 -->\n",
    );
  });

  it("글자 속 줄바꿈은 공백으로 바꿔 한 항목이 한 줄을 넘지 않게 한다", () => {
    expect(serializeTodos([{ text: "첫 줄\n둘째 줄\r\n셋째", done: false }])).toBe(
      "- [ ] 첫 줄 둘째 줄 셋째\n",
    );
  });
});

describe("parseTodos", () => {
  it("빈 문자열은 빈 목록이다", () => {
    expect(parseTodos("")).toEqual([]);
  });

  it("- [ ] 줄은 미완료 할 일이다", () => {
    expect(parseTodos("- [ ] 장보기\n")).toEqual([{ text: "장보기", done: false }]);
  });

  it("- [x] 줄은 완료한 할 일이고, 대문자 X도 같다", () => {
    expect(parseTodos("- [x] 회의\n- [X] 리뷰\n")).toEqual([
      { text: "회의", done: true },
      { text: "리뷰", done: true },
    ]);
  });

  it("목록 기호 *와 +도 할 일로 읽는다", () => {
    expect(parseTodos("* [ ] 하나\n+ [x] 둘\n")).toEqual([
      { text: "하나", done: false },
      { text: "둘", done: true },
    ]);
  });

  it("넘어온 날짜 주석을 from으로 읽고 글자에서는 뺀다", () => {
    expect(parseTodos("- [ ] PR 리뷰 <!-- from:2026-10-12 -->\n")).toEqual([
      { text: "PR 리뷰", done: false, from: "2026-10-12" },
    ]);
  });

  it("할 일이 아닌 줄(빈 줄, 제목, 일반 문장, 체크박스 없는 목록)은 무시한다", () => {
    const md = "# 2026-10-14\n\n메모 한 줄\n- 그냥 목록\n- [ ] 진짜 할 일\n";
    expect(parseTodos(md)).toEqual([{ text: "진짜 할 일", done: false }]);
  });

  it("앱이 쓴 파일은 읽고 다시 써도 원본과 같다", () => {
    const md = "- [ ] 장보기\n- [x] 회의\n- [ ] PR 리뷰 <!-- from:2026-10-12 -->\n";
    expect(serializeTodos(parseTodos(md))).toBe(md);
  });

  it("윈도우 줄바꿈(CRLF)으로 저장된 파일도 읽는다", () => {
    expect(parseTodos("- [ ] 하나\r\n- [x] 둘\r\n")).toEqual([
      { text: "하나", done: false },
      { text: "둘", done: true },
    ]);
  });
});

describe("버그 수정: 형식", () => {
  it("끝 공백이 없는 빈 할 일 줄('- [ ]')도 할 일로 읽는다", () => {
    expect(parseTodos("- [ ]\n- [x]\n")).toEqual([
      { text: "", done: false },
      { text: "", done: true },
    ]);
  });

  it("할 일 바로 아래 들여쓴 줄(하위 할 일)은 그 할 일에 붙어 다니며 자리를 지킨다", () => {
    const md = "- [ ] 상위\n  - [ ] 하위\n  메모\n- [ ] 다음\n";
    const doc = parseDocument(md);
    expect(doc.todos[0].children).toEqual(["  - [ ] 하위", "  메모"]);
    expect(doc.notes).toBe("");
    doc.todos[1].done = true;
    expect(serializeDocument(doc)).toBe("- [ ] 상위\n  - [ ] 하위\n  메모\n- [x] 다음\n");
  });

  it("첫 할 일보다 앞에 있거나 빈 줄 뒤에 있는 들여쓴 줄은 메모다", () => {
    const doc = parseDocument("  앞 메모\n- [ ] 하나\n\n  떨어진 메모\n");
    expect(doc.todos).toEqual([{ text: "하나", done: false }]);
    expect(doc.notes).toBe("  앞 메모\n\n  떨어진 메모");
  });

  it("글자가 넘어온 날짜 주석처럼 끝나도 다시 읽으면 글자가 그대로다", () => {
    const todo = { text: "주석 예시 <!-- from:2026-01-01 -->", done: false };
    expect(parseTodos(serializeTodos([todo]))).toEqual([todo]);
    const moved = { ...todo, from: "2026-10-12" };
    expect(parseTodos(serializeTodos([moved]))).toEqual([moved]);
  });

  it("글자가 비었거나 공백뿐인 항목은 파일에 쓰지 않는다", () => {
    expect(
      serializeTodos([
        { text: "", done: false },
        { text: "   ", done: false },
        { text: "하나", done: false },
      ]),
    ).toBe("- [ ] 하나\n");
  });
});

describe("AI가 넣은 할 일 표시", () => {
  it("ai 주석을 누가·언제 넣었는지로 읽고 글자에서는 뺀다", () => {
    expect(parseTodos("- [ ] PR 리뷰 <!-- ai:claude-code@1792040000 -->\n")).toEqual([
      { text: "PR 리뷰", done: false, ai: { by: "claude-code", at: 1792040000 } },
    ]);
  });

  it("넘어온 날짜와 AI 표시가 함께 있으면 둘 다 읽고, 다시 쓰면 원본과 같다", () => {
    const md = "- [ ] PR 리뷰 <!-- from:2026-10-14 ai:codex@1792040000 -->\n";
    expect(parseTodos(md)).toEqual([
      { text: "PR 리뷰", done: false, from: "2026-10-14", ai: { by: "codex", at: 1792040000 } },
    ]);
    expect(serializeDocument(parseDocument(md))).toBe(md);
  });

  it("AI 표시가 없어지면 주석도 없어진다", () => {
    expect(serializeTodos([{ text: "PR 리뷰", done: false }])).toBe("- [ ] PR 리뷰\n");
  });

  it("글자가 AI 주석처럼 끝나도 다시 읽으면 글자가 그대로다", () => {
    const todo = { text: "주석 예시 <!-- ai:x@1 -->", done: false };
    expect(parseTodos(serializeTodos([todo]))).toEqual([todo]);
  });

  it("예전 형식(넘어온 날짜만, 빈 주석)도 그대로 읽는다", () => {
    expect(parseTodos("- [ ] 하나 <!-- from:2026-10-13 -->\n- [ ] 둘 <!-- from: -->\n")).toEqual([
      { text: "하나", done: false, from: "2026-10-13" },
      { text: "둘", done: false },
    ]);
  });
});
