import { describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const load = async () => {
  vi.resetModules();
  return import("./os");
};

describe("os", () => {
  it("묻기 전에는 macos다", async () => {
    const { currentOs } = await load();
    expect(currentOs()).toBe("macos");
  });

  it("Rust가 알려 준 OS를 쓰고, 한 번만 묻는다", async () => {
    invoke.mockClear().mockResolvedValue({ os: "windows" });
    const { currentOs, resolveOs } = await load();
    expect(await resolveOs()).toBe("windows");
    expect(await resolveOs()).toBe("windows");
    expect(currentOs()).toBe("windows");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("platform_info");
  });

  it("platform_info가 없는 앱이면 userAgent로 짐작한다", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("command platform_info not found")));
    const ua = vi.spyOn(navigator, "userAgent", "get");
    const guessed: string[] = [];
    for (const agent of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    ]) {
      ua.mockReturnValue(agent);
      guessed.push(await (await load()).resolveOs());
    }
    ua.mockRestore();
    expect(guessed).toEqual(["windows", "macos"]);
  });

  it("알 수 없는 값이 오면 userAgent로 짐작한다", async () => {
    invoke.mockResolvedValue({ os: "beos" });
    expect(await (await load()).resolveOs()).toBe("macos");
  });
});
