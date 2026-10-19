import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutoSaver } from "../core/autoSaver";
import { FOLDER_KEPT, SOURCE_UNAVAILABLE, isUndecodable, switchFolder, useStorageHealth } from "./useStorageHealth";

afterEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});

describe("isUndecodable", () => {
  it("Rust가 보내는 한국어 표지로 글자로 풀 수 없는 파일을 알아본다", () => {
    expect(isUndecodable("글자로 풀 수 없는 파일이에요 (UTF-8이 아니에요)")).toBe(true);
    expect(isUndecodable("읽지 못했어요: 디스크를 읽고 쓰다 문제가 생겼어요")).toBe(false);
    expect(isUndecodable("저장 폴더를 열 수 없어요: /Volumes/USB")).toBe(false);
  });
});

describe("폴더를 바꾼 뒤의 안내", () => {
  it("할 일을 옮기지 않고 바꿨으면 새로고침 뒤 창 아래에 10초 동안 알리고, 한 번만 보인다", () => {
    vi.useFakeTimers();
    sessionStorage.setItem("aru.folderKept", "kept");
    const health = useStorageHealth();
    expect(health.info.value).toBe(FOLDER_KEPT);
    vi.advanceTimersByTime(9_900);
    expect(health.info.value).toBe(FOLDER_KEPT);
    vi.advanceTimersByTime(200);
    expect(health.info.value).toBeNull();
    expect(useStorageHealth().info.value).toBeNull();
  });

  it("지금 폴더를 열 수 없어 옮기지 못했으면(sourceUnavailable) 그 이유로 알린다", () => {
    sessionStorage.setItem("aru.folderKept", "sourceUnavailable");
    expect(useStorageHealth().info.value).toBe(SOURCE_UNAVAILABLE);
  });

  it("안내는 실패 알림(notice)과 따로 둔다 — 화면은 폴더를 열 수 없다는 경고를 이 안내보다 앞에 둔다", () => {
    sessionStorage.setItem("aru.folderKept", "kept");
    const health = useStorageHealth();
    expect(health.notice.value).toBeNull();
    expect(health.info.value).toBe(FOLDER_KEPT);
  });
});

describe("switchFolder: 할 일이 이미 있는 폴더(kept) (QA6-04)", () => {
  const stuckSaver = () =>
    ({ discard: vi.fn(), rebaseAll: vi.fn(), flush: async () => false, idle: () => false }) as unknown as AutoSaver;

  it("새 폴더에 아직 저장하지 못해 창이 남아도 설정은 곧바로 새 폴더 것으로 다시 읽는다", async () => {
    const health = useStorageHealth();
    const reloadSettings = vi.fn(async () => {});
    await switchFolder(health, stuckSaver(), [], async () => {}, reloadSettings, { copied: false, reason: "kept" });
    expect(reloadSettings).toHaveBeenCalledTimes(1);
    expect(health.notice.value).toMatch(/아직 저장하지 못했어요/);
  });

  it("기본 폴더로 되돌렸거나(null) 이전 폴더를 열 수 없어 옮기지 못했어도 새 폴더 설정을 다시 읽는다 (리뷰 N6)", async () => {
    const reloadSettings = vi.fn(async () => {});
    await switchFolder(useStorageHealth(), stuckSaver(), [], async () => {}, reloadSettings, null);
    await switchFolder(useStorageHealth(), stuckSaver(), [], async () => {}, reloadSettings, { copied: false, reason: "sourceUnavailable" });
    expect(reloadSettings).toHaveBeenCalledTimes(2);
  });

  it("할 일을 옮겼으면(copied) 설정도 옮겨졌으므로 다시 읽지 않는다", async () => {
    const reloadSettings = vi.fn(async () => {});
    await switchFolder(useStorageHealth(), stuckSaver(), [], async () => {}, reloadSettings, { copied: true, reason: "copied" });
    expect(reloadSettings).not.toHaveBeenCalled();
  });
});

describe("switchFolder: 입력칸 글 (QA9-02)", () => {
  it("새로고침 전에 입력칸에 쓰다 만 글을 먼저 할 일로 넣고, 그다음 저장한다", async () => {
    const order: string[] = [];
    const saver = {
      discard: vi.fn(),
      rebaseAll: () => order.push("rebase"),
      flush: async () => (order.push("flush"), false),
      idle: () => false,
    } as unknown as AutoSaver;
    const commitDrafts = () => order.push("commit");
    await switchFolder(useStorageHealth(), saver, [], async () => {}, async () => {}, { copied: false, reason: "kept" }, commitDrafts);
    expect(order[0]).toBe("commit");
    expect(order).toContain("flush");
  });
});
