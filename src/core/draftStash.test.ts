import { beforeEach, describe, expect, it } from "vitest";
import { dropOrphan, keepDraft, keptDraft, orphan, orphanDrafts, orphans } from "./draftStash";

describe("입력칸 글 안전망", () => {
  beforeEach(() => localStorage.clear());

  it("쓰는 대로 남기고, 비우면(넣었으면) 지운다", () => {
    keepDraft("main.today", "쓰다만");
    expect(keptDraft("main.today")).toBe("쓰다만");
    keepDraft("main.today", "  ");
    expect(keptDraft("main.today")).toBe("");
    expect(localStorage.length).toBe(0);
  });

  it("창이 남긴 글(거울)을 넘길 글(orphan)로 옮긴다. 그 창 것만, 같은 글은 한 번만", () => {
    keepDraft("main.today", "내 것");
    keepDraft("quick.today", "빠른1\n빠른2");
    keepDraft("quick.someday", "언젠");
    orphan("quick.today", ["빠른1"]);
    orphanDrafts("quick");
    expect(keptDraft("quick.today")).toBe("");
    expect(keptDraft("quick.someday")).toBe("");
    expect(keptDraft("orphan.quick.today")).toBe("빠른1\n빠른2");
    expect(keptDraft("orphan.quick.someday")).toBe("언젠");
    expect(keptDraft("main.today")).toBe("내 것");
  });

  it("H1 넘길 글은 그 창의 거울을 비워도(빠른 입력창이 처음 뜸) 지워지지 않고, 넣은 자리만 지운다", () => {
    orphan("quick.someday", ["우유", "빵"]);
    keepDraft("quick.someday", "");
    expect(keptDraft("orphan.quick.someday")).toBe("우유\n빵");
    orphan("overview.day", ["모아"]);
    expect(orphans()).toEqual([
      { slot: "overview.day", texts: ["모아"] },
      { slot: "quick.someday", texts: ["우유", "빵"] },
    ]);
    dropOrphan("overview.day");
    dropOrphan("quick.someday");
    expect(localStorage.length).toBe(0);
  });

  it("localStorage를 못 쓰는 환경이면 조용히 아무것도 하지 않는다", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("denied");
    };
    try {
      expect(() => keepDraft("main.today", "글")).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
