import { describe, expect, it } from "vitest";
import { dumpItems, parseItems } from "./todoFile";

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
