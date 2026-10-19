import { describe, expect, it } from "vitest";
import { dumpItems, mergeTodoContent, parseItems, prependTodoIfNew, renameIds } from "./todoFile";

const prependTodo = (markdown: string, text: string) => prependTodoIfNew(markdown, text).content;
import { settleChecked, toggle, updateText } from "./todoList";

describe("parseItems / dumpItems", () => {
  it("파일 내용을 화면용 항목(id 포함)과 메모로 나누고, 다시 합치면 원래 내용이 된다", () => {
    let n = 0;
    const md = "- [ ] 하나\n- [x] 둘 <!-- from:2026-10-12 -->\n\n메모\n";

    const { items, doc } = parseItems(md, () => `id${++n}`);

    expect(items).toEqual([
      { id: "id1", text: "하나", done: false },
      { id: "id2", text: "둘", done: true, from: "2026-10-12" },
    ]);
    expect(dumpItems(items, doc)).toBe(md);
  });
});

describe("prependTodo", () => {
  it("빠른 입력창에서 쓴 할 일은 맨 위에 넣고, 끝낸 일과 메모는 그대로 둔다", () => {
    expect(prependTodo("- [ ] 하나\n- [x] 끝낸 일\n\n메모\n", "  새 일 ")).toBe(
      "- [ ] 새 일\n- [ ] 하나\n- [x] 끝낸 일\n\n메모\n",
    );
  });

  it("파일이 없거나 비어 있으면 그 할 일 하나만 쓴다", () => {
    expect(prependTodo("", "새 일")).toBe("- [ ] 새 일\n");
  });
});

describe("UI-07: 빠른 입력 중복 건너뛰기", () => {
  it("같은 날 안 끝낸 똑같은 할 일이 있으면 건너뛰고 내용을 바꾸지 않는다", () => {
    const md = "- [ ] 장보기\n- [x] 운동\n";
    expect(prependTodoIfNew(md, "장보기")).toEqual({ content: md, skipped: true });
    expect(prependTodoIfNew(md, "  장보기\u00a0 ")).toEqual({ content: md, skipped: true });
    expect(prependTodo(md, "장보기")).toBe(md);
  });

  it("끝낸 일과 같은 글자는 새로 넣는다", () => {
    expect(prependTodoIfNew("- [x] 운동\n", "운동")).toEqual({
      content: "- [ ] 운동\n- [x] 운동\n",
      skipped: false,
    });
  });

  it("넣는 글자의 줄바꿈 계열 글자는 공백이 되어 할 일로 남는다", () => {
    expect(prependTodo("", "복사한\u2028글")).toBe("- [ ] 복사한 글\n");
  });
});

describe("UI-04: 메모 자리를 화면 계층을 거쳐도 지킨다", () => {
  it("parseItems → dumpItems 왕복에서 제목·사이 줄·BOM·목록 기호가 그대로다", () => {
    const md = "\ufeff# 계획\n\n* [ ] 가\n## 오후\n- [X] 나\n\n메모\n";
    const { items, doc } = parseItems(md, () => "id");
    expect(dumpItems(items, doc)).toBe(md);
  });

  it("빠른 입력은 맨 위 제목 아래에 넣는다", () => {
    expect(prependTodo("# 제목\n\n- [ ] 가\n", "새")).toBe("# 제목\n\n- [ ] 새\n- [ ] 가\n");
  });
});

describe("라운드 2: 배치 정보는 항목 정체(id)에 붙는다", () => {
  let n = 0;
  const id = () => `r${++n}`;

  it("N12: 같은 글자의 할 일이 둘인 파일을 손대지 않고 쓰면 한 글자도 바뀌지 않는다", () => {
    for (const md of [
      "## 오전\n- [x] 운동\n- [ ] 메일\n## 저녁\n- [ ] 운동\n",
      "- [ ] 메일\n## 오후\n- [ ] 메일\n- [ ] 운동\n",
    ]) {
      const { items, doc } = parseItems(md, id);
      expect(dumpItems(items, doc)).toBe(md);
    }
  });

  it("QA2-04: 다른 항목만 체크해도 소제목은 원래 붙어 있던 같은 글자 항목에 남는다", () => {
    const { items, doc } = parseItems("- [ ] 메일\n## 오후\n- [ ] 메일\n- [ ] 운동\n", id);
    expect(dumpItems(toggle(items, items[2].id), doc)).toBe("- [ ] 메일\n## 오후\n- [ ] 메일\n- [x] 운동\n");
  });

  it("QA2-04: 빠른 입력으로 끝낸 일과 같은 글자를 넣어도 소제목은 끝낸 일 위에 남는다", () => {
    expect(prependTodo("- [ ] a\n## 오후\n- [x] b\n", "b")).toBe("- [ ] b\n- [ ] a\n## 오후\n- [x] b\n");
  });

  it("QA2-05: 소제목 아래 항목의 글자를 고친 뒤 다른 항목을 옮겨도 소제목은 고친 항목을 따라간다", () => {
    const { items, doc } = parseItems("- [ ] a\n## 오후\n- [ ] b\n- [ ] c\n", id);
    let list = updateText(items, items[1].id, "b2");
    list = settleChecked(toggle(list, items[0].id), items[0].id);
    expect(dumpItems(list, doc)).toBe("## 오후\n- [ ] b2\n- [ ] c\n- [x] a\n");
  });

  it("다시 읽어 id가 바뀌어도(renameIds) 배치 정보가 새 id를 따라간다", () => {
    const { items, doc } = parseItems("- [ ] a\n## 오후\n- [ ] b\n", id);
    const renamed = renameIds(doc, new Map(items.map((t) => [t.id, `old-${t.id}`])));
    const list = items.map((t) => ({ ...t, id: `old-${t.id}` }));
    const edited = settleChecked(toggle(updateText(list, list[1].id, "b!"), list[0].id), list[0].id);
    expect(dumpItems(edited, renamed)).toBe("## 오후\n- [ ] b!\n- [x] a\n");
  });

  it("DocTail은 문자열과 섞어 쓸 수 없다(컴파일러가 막는다)", () => {
    const { items } = parseItems("- [ ] a\n", id);
    // @ts-expect-error 메모 글자를 그대로 넘기면 안 된다
    expect(() => dumpItems(items, "메모")).not.toThrow();
  });
});

describe("라운드 2: 줄 끝(CRLF)과 닫히지 않은 코드 블록", () => {
  it("CRLF 파일은 앱이 고쳐 써도 CRLF로 남는다(BOM도)", () => {
    const md = "﻿# 제목\r\n\r\n- [ ] a\r\n\r\n메모\r\n";
    expect(prependTodo(md, "새")).toBe("﻿# 제목\r\n\r\n- [ ] 새\r\n- [ ] a\r\n\r\n메모\r\n");
    let k = 0;
    const { items, doc } = parseItems("# t\r\n- [ ] a\r\n- [ ] b\r\n메모\r\n", () => `c${++k}`);
    expect(dumpItems(toggle(items, items[0].id), doc)).toBe("# t\r\n- [x] a\r\n- [ ] b\r\n메모\r\n");
  });

  it("닫히지 않은 코드 블록은 코드 블록이 아니다 — 그 아래 할 일이 보인다", () => {
    expect(parseItems("- [ ] a\n```\n- [ ] b\n", () => "x").items.map((t) => t.text)).toEqual(["a", "b"]);
    expect(parseItems("- [ ] a\n  ```\n- [ ] b\n", () => "x").items.map((t) => t.text)).toEqual(["a", "b"]);
    // 짧은 펜스로는 긴 펜스가 닫히지 않는다
    expect(parseItems("````\n- [ ] 안\n```\n- [ ] 밖\n", () => "x").items.map((t) => t.text)).toEqual(["안", "밖"]);
    // 닫힌 블록은 그대로 예시 글이다
    expect(parseItems("~~~\n- [ ] 예시\n~~~\n- [ ] 진짜\n", () => "x").items.map((t) => t.text)).toEqual(["진짜"]);
  });

  it("손대지 않은 파일은 닫히지 않은 펜스가 있어도 그대로 쓴다", () => {
    const md = "- [ ] a\n```\n- [ ] b\n메모\n";
    const { items, doc } = parseItems(md, () => "x");
    expect(dumpItems(items, doc)).toBe(md);
  });
});

describe("라운드 2: NBSP가 든 원래 줄과 합치기", () => {
  it("손대지 않은 NBSP 줄은 내 쪽에서도 원래 줄 그대로라, 저쪽이 지우면 내 쪽에서도 지워진다", () => {
    const base = "- [ ] a\u00a0b\n- [ ] c\n";
    let n = 0;
    const { items, doc } = parseItems(base, () => `m${++n}`);
    const mine = dumpItems([...items, { id: "new", text: "내가 추가", done: false }], doc);
    expect(mine).toBe("- [ ] a\u00a0b\n- [ ] c\n- [ ] 내가 추가\n");
    expect(mergeTodoContent(base, mine, "- [ ] c\n")).toBe("- [ ] c\n- [ ] 내가 추가\n");
  });

  it("앱 형식과 다른 원래 줄(글자 속 CR 등)도 손대지 않으면 그대로 쓴다", () => {
    const md = "- [ ] new\r\r\n- [ ] a\u2028b\n";
    const { items, doc } = parseItems(md, () => "x");
    expect(dumpItems(items, doc)).toBe(md);
  });
});

describe("라운드 2: 줄 끝이 섞인 파일(aru 명령과 같은 규칙)", () => {
  it("있던 줄은 제 줄 끝을 지키고, 새 줄은 많은 쪽을 따른다", () => {
    expect(prependTodo("# 제목\r\n- [ ] a\n메모\n", "b")).toBe("# 제목\r\n- [ ] b\n- [ ] a\n메모\n");
    expect(prependTodo("# 제목\r\n- [ ] a\r\n메모\n", "b")).toBe("# 제목\r\n- [ ] b\r\n- [ ] a\r\n메모\n");
  });

  it("줄 끝이 섞인 파일도 손대지 않으면 그대로 쓴다", () => {
    const md = "# t\r\n- [ ] a\n\r\n메모\r\n";
    const { items, doc } = parseItems(md, () => "x");
    expect(dumpItems(items, doc)).toBe(md);
  });
});

describe("보이지 않는 글자만 쓴 할 일 (QA3-06)", () => {
  it("폭 0 공백·BOM·소프트 하이픈 같은 보이지 않는 글자만 있으면 빈 글로 보고 넣지 않는다", () => {
    for (const text of ["​", "‌", "‍", "⁠", "﻿", "­", " ​⁠ ", "　"]) {
      expect(prependTodoIfNew("- [ ] 원래\n", text)).toEqual({ content: "- [ ] 원래\n", skipped: true });
    }
  });

  it("글자 사이의 ZWJ(이모지 조합)는 그대로 둔다", () => {
    const family = "👨‍👩‍👧 가족 모임";
    expect(prependTodoIfNew("", family)).toEqual({ content: `- [ ] ${family}\n`, skipped: false });
  });
});

describe("다른 편집기가 쓴 보이지 않는 글자만 있는 줄 (QA5-06, PRINCIPLES 3)", () => {
  const md = "- [ ] a\n- [x] ㅤ\n- [ ] ⠀\n- [ ] \n- [ ] b\n";

  it("그 줄을 건드리지 않았으면 다른 할 일을 고쳐도 원래대로 남긴다", () => {
    const { items, doc } = parseItems(md, () => crypto.randomUUID());
    expect(dumpItems(toggle(items, items[0].id), doc)).toBe("- [x] a\n- [x] ㅤ\n- [ ] ⠀\n- [ ] \n- [ ] b\n");
  });

  it("앱에서 지워 빈 칸으로 만든 할 일과 새로 만든 빈 칸은 쓰지 않는다", () => {
    const { items, doc } = parseItems(md, () => crypto.randomUUID());
    const edited = updateText(items, items[4].id, "​");
    const added = [...edited, { id: "new", text: "", done: false }];
    expect(dumpItems(added, doc)).toBe("- [ ] a\n- [x] ㅤ\n- [ ] ⠀\n- [ ] \n");
  });

  it("남겨 두는 건 원래 있던 개수까지다 — 같은 모양의 빈 칸을 앱에서 더 만들면 그만큼은 쓰지 않는다", () => {
    const { items, doc } = parseItems("- [ ] a\n- [ ] ⠀\n", () => crypto.randomUUID());
    const more = [...items, { id: "x", text: "⠀", done: false }];
    expect(dumpItems(more, doc)).toBe("- [ ] a\n- [ ] ⠀\n");
  });
});
