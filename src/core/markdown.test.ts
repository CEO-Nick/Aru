import { describe, expect, it } from "vitest";
import { parseDocument, parseTodos, serializeDocument, serializeTodos } from "./markdown";
import { normalizeTodoText } from "./text";

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

  it("할 일 사이에 끼어 있던 메모는 그 자리에 남는다", () => {
    const doc = parseDocument("- [ ] 하나\n메모\n- [ ] 둘\n");
    expect(serializeDocument(doc)).toBe("- [ ] 하나\n메모\n- [ ] 둘\n");
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
    const md = "  앞 메모\n- [ ] 하나\n\n  떨어진 메모\n";
    const doc = parseDocument(md);
    expect(doc.todos).toEqual([{ text: "하나", done: false }]);
    expect(doc.notes).toBe("  떨어진 메모");
    expect(serializeDocument(doc)).toBe(md);
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

describe("UI-03: 줄바꿈 계열 글자가 섞인 할 일", () => {
  it("U+2028·U+2029·CR이 든 할 일 줄이 이미 파일에 있어도 할 일로 읽는다", () => {
    expect(parseTodos("- [ ] 회의 준비\u2028자료\n- [ ] 가\u2029나\n- [ ] 첫줄\r둘째줄\n")).toEqual([
      { text: "회의 준비 자료", done: false },
      { text: "가 나", done: false },
      { text: "첫줄 둘째줄", done: false },
    ]);
  });

  it("저장할 때 할 일 글자 속 줄바꿈 계열 글자는 공백이 되어 다시 읽어도 할 일이다", () => {
    for (const text of ["a\u2028b", "a\u2029b", "a\rb"]) {
      const out = serializeTodos([{ text, done: false }]);
      expect(out).toBe("- [ ] a b\n");
      expect(parseTodos(out)).toEqual([{ text: "a b", done: false }]);
    }
  });
});

describe("UI-04: 앱이 모르는 줄의 자리와 모양", () => {
  it("할 일 위의 제목과 빈 줄은 체크하고 저장해도 위에 남는다", () => {
    const doc = parseDocument("# 10월 14일 계획\n\n- [ ] 가\n- [ ] 나\n");
    doc.todos = [doc.todos[1], { ...doc.todos[0], done: true }];
    expect(serializeDocument(doc)).toBe("# 10월 14일 계획\n\n- [ ] 나\n- [x] 가\n");
  });

  it("할 일 사이의 줄은 바로 뒤 할 일 앞에 붙어 다닌다", () => {
    const doc = parseDocument("## 오전\n- [ ] 가\n## 오후\n- [ ] 나\n");
    expect(serializeDocument(doc)).toBe("## 오전\n- [ ] 가\n## 오후\n- [ ] 나\n");
    doc.todos = [doc.todos[1], { ...doc.todos[0], done: true }];
    expect(serializeDocument(doc)).toBe("## 오전\n## 오후\n- [ ] 나\n- [x] 가\n");
  });

  it("붙어 있던 할 일을 지우거나 고쳐도 그 줄은 원래 순번 자리에 남는다", () => {
    const doc = parseDocument("- [ ] 가\n## 오후\n- [ ] 나\n- [ ] 다\n");
    doc.todos = [doc.todos[0], doc.todos[2]];
    expect(serializeDocument(doc)).toBe("- [ ] 가\n## 오후\n- [ ] 다\n");
    doc.todos = [doc.todos[0]];
    expect(serializeDocument(doc)).toBe("- [ ] 가\n## 오후\n");
  });

  it("맨 위에 넣은 할 일은 제목 아래, 기존 할 일 위에 들어간다", () => {
    const doc = parseDocument("# 제목\n- [ ] 가\n");
    doc.todos = [{ text: "새", done: false }, ...doc.todos];
    expect(serializeDocument(doc)).toBe("# 제목\n- [ ] 새\n- [ ] 가\n");
  });

  it("손대지 않은 줄은 목록 기호(*, +)와 대문자 X를 그대로 쓰고, 체크를 바꾼 줄만 앱 형식으로 쓴다", () => {
    const md = "* [ ] 별\n+ [X] 더하기\n- [X] 대문자\n";
    const doc = parseDocument(md);
    expect(serializeDocument(doc)).toBe(md);
    doc.todos[2] = { ...doc.todos[2], done: false };
    expect(serializeDocument(doc)).toBe("* [ ] 별\n+ [X] 더하기\n- [ ] 대문자\n");
  });

  it("코드 블록 안의 할 일 모양 줄은 할 일이 아니고 그대로 남는다", () => {
    const md = "- [ ] 진짜\n\n```md\n- [ ] 예시 줄\n```\n";
    const doc = parseDocument(md);
    expect(doc.todos).toEqual([{ text: "진짜", done: false }]);
    expect(serializeDocument(doc)).toBe(md);
    doc.todos[0] = { ...doc.todos[0], done: true };
    expect(serializeDocument(doc)).toBe("- [x] 진짜\n\n```md\n- [ ] 예시 줄\n```\n");
  });

  it("할 일 사이에 있는 코드 블록도 줄 하나 바뀌지 않는다", () => {
    const md = "- [ ] 가\n~~~\n- [ ] 안\n\n~~~\n- [ ] 나\n";
    const doc = parseDocument(md);
    expect(doc.todos.map((t) => t.text)).toEqual(["가", "나"]);
    expect(serializeDocument(doc)).toBe(md);
  });

  it("BOM으로 시작하는 파일도 첫 할 일을 읽고, 쓸 때 BOM을 되돌려 둔다", () => {
    const md = "\ufeff- [ ] 첫째\n- [ ] 둘째\n";
    const doc = parseDocument(md);
    expect(doc.todos.map((t) => t.text)).toEqual(["첫째", "둘째"]);
    expect(serializeDocument(doc)).toBe(md);
  });

  it("마지막 할 일과 아래 메모 사이의 빈 줄 개수를 지킨다", () => {
    expect(serializeDocument(parseDocument("- [ ] 가\n메모\n"))).toBe("- [ ] 가\n메모\n");
    expect(serializeDocument(parseDocument("- [ ] 가\n\n\n메모\n"))).toBe("- [ ] 가\n\n\n메모\n");
  });
});

describe("UI-12: NBSP", () => {
  it("할 일 글자 속 NBSP와 BOM은 파일에 쓰지 않는다", () => {
    expect(serializeTodos([{ text: "a\u00a0\u00a0b\u00a0\ufeff", done: false }])).toBe("- [ ] a  b \n");
  });
});

describe("UI-14: 표시 주석 앞의 끝 공백", () => {
  it("끝 공백이 있는 글자에 넘어온 날짜·AI 표시가 붙어도 다시 읽으면 끝 공백이 남는다", () => {
    for (const todo of [
      { text: "보고서 ", done: false, from: "2026-10-13" },
      { text: "1  ", done: false, ai: { by: "codex", at: 1 } },
    ]) {
      expect(parseTodos(serializeTodos([todo]))).toEqual([todo]);
    }
  });

  it("주석 앞 공백이 없거나 한 칸인 기존 파일은 전과 같이 읽는다", () => {
    expect(parseTodos("- [ ] 가<!-- from:2026-10-13 -->\n- [ ] 나 <!-- from:2026-10-13 -->\n")).toEqual([
      { text: "가", done: false, from: "2026-10-13" },
      { text: "나", done: false, from: "2026-10-13" },
    ]);
  });
});

describe("저장 후 다시 읽기 왕복", () => {
  it("무작위 글자·표시·메모 배치에서도 할 일과 메모 줄이 그대로 돌아온다", () => {
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const pieces = ["가", "a", " ", "  ", "\u2028", "\u2029", "\r", "\r\n", "\n", "\u00a0", "\ufeff", "<!-- from:2026-01-01 -->", "<!-- ai:x@1 -->", "- [ ] ", "```", "#"];
    const text = () => Array.from({ length: rand(6) }, () => pieces[rand(pieces.length)]).join("");
    for (let n = 0; n < 3000; n++) {
      const todos = Array.from({ length: 1 + rand(4) }, () => ({
        text: text(),
        done: rand(2) === 0,
        ...(rand(3) === 0 ? { from: "2026-10-13" } : {}),
        ...(rand(4) === 0 ? { ai: { by: "codex", at: 1 } } : {}),
      }));
      const written = todos.filter((t) => normalizeTodoText(t.text).trim() !== "");
      const md = serializeTodos(todos);
      expect(parseTodos(md)).toEqual(written.map((t) => ({ ...t, text: normalizeTodoText(t.text) })));
      expect(serializeTodos(parseTodos(md))).toBe(md);
    }
  });

  it("메모가 섞인 파일은 손대지 않고 저장하면 한 글자도 바뀌지 않는다", () => {
    for (const md of [
      "# 제목\n\n- [ ] 가\n- [x] 나 <!-- from:2026-10-13 -->\n  - [ ] 하위\n## 오후\n\n* [X] 다\n\n메모\n\n끝\n",
      "\ufeff\n- [ ] 가\n```\n- [ ] 코드\n```\n- [ ] 나\n메모\n",
      "메모만\n",
      "",
    ]) {
      expect(serializeDocument(parseDocument(md))).toBe(md);
    }
  });
});

describe("QA4-04: 보이지 않는 글자만 있는 할 일", () => {
  it("파일에 쓰지 않는다(하위 줄이 없을 때). 보이는 글자가 있는 할 일은 그대로 쓴다", () => {
    const out = serializeDocument({
      todos: [
        { text: "하나", done: false },
        { text: "​", done: true },
        { text: "ㅤ⠀", done: false },
        { text: "‎", done: false, children: ["  - 메모"] },
        { text: "👨‍👩‍👧", done: false },
      ],
      notes: "",
    });
    expect(out).toBe("- [ ] 하나\n- [ ] ‎\n  - 메모\n- [ ] 👨‍👩‍👧\n");
  });
});
