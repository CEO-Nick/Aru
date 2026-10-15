import { describe, expect, it } from "vitest";
import { dumpItems, parseItems, prependTodo } from "./todoFile";

describe("parseItems / dumpItems", () => {
  it("파일 내용을 화면용 항목(id 포함)과 메모로 나누고, 다시 합치면 원래 내용이 된다", () => {
    let n = 0;
    const md = "- [ ] 하나\n- [x] 둘 <!-- from:2026-10-12 -->\n\n메모\n";

    const { items, notes } = parseItems(md, () => `id${++n}`);

    expect(items).toEqual([
      { id: "id1", text: "하나", done: false },
      { id: "id2", text: "둘", done: true, from: "2026-10-12" },
    ]);
    expect(dumpItems(items, notes)).toBe(md);
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
