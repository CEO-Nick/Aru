import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SaveStatus from "./SaveStatus.vue";

describe("SaveStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("마지막으로 저장한 시각을 함께 보여준다", () => {
    const wrapper = mount(SaveStatus, {
      props: { status: "saved", savedAt: new Date(2026, 9, 14, 16, 5, 9).getTime() },
    });
    expect(wrapper.find(".status").text()).toBe("저장됨");
    expect(wrapper.find(".time").text()).toBe("16:05");
  });

  it("저장할 때마다 잠깐 반짝이고 1.2초 뒤 사라진다", async () => {
    const wrapper = mount(SaveStatus, { props: { status: "saved", savedAt: 1 } });
    expect(wrapper.find(".foot").classes("flash")).toBe(false);

    await wrapper.setProps({ savedAt: 2 });
    expect(wrapper.find(".foot").classes("flash")).toBe(true);

    await vi.advanceTimersByTimeAsync(1200);
    expect(wrapper.find(".foot").classes("flash")).toBe(false);
  });

  it("저장 전이거나 실패 중이면 시각을 보이지 않는다", () => {
    const wrapper = mount(SaveStatus, { props: { status: "pending", savedAt: 5 } });
    expect(wrapper.find(".time").exists()).toBe(false);
  });
});

describe("SaveStatus: 안내(info)와 문제(alert)·저장 실패 (QA4-05)", () => {
  it("안내는 저장 상태 대신 보이되 점은 빨간 오류 점이 아니다", () => {
    const wrapper = mount(SaveStatus, { props: { status: "saved", savedAt: 5, info: "이미 할 일이 있는 폴더라 옮기지 않았어요" } });
    expect(wrapper.find(".status").text()).toBe("이미 할 일이 있는 폴더라 옮기지 않았어요");
    expect(wrapper.find(".dot").classes()).toContain("info");
    expect(wrapper.find(".dot").classes()).not.toContain("error");
    expect(wrapper.find(".status").attributes("title")).toBe("이미 할 일이 있는 폴더라 옮기지 않았어요");
    expect(wrapper.find(".time").exists()).toBe(false);
  });

  it("저장이 실패하면 안내보다 저장 실패를 먼저 보인다", () => {
    const wrapper = mount(SaveStatus, { props: { status: "error", info: "이미 할 일이 있는 폴더라 옮기지 않았어요" } });
    expect(wrapper.find(".status").text()).toBe("저장 실패 — 다시 시도합니다");
    expect(wrapper.find(".dot").classes()).toContain("error");
  });

  it("문제 알림(alert)은 안내보다 먼저다", () => {
    const wrapper = mount(SaveStatus, { props: { status: "saved", alert: "저장 폴더를 열 수 없어요", info: "안내" } });
    expect(wrapper.find(".status").text()).toBe("저장 폴더를 열 수 없어요");
    expect(wrapper.find(".dot").classes()).toContain("error");
  });
});

describe("SaveStatus: 응답 없는 쓰기 (라운드 5 QA5-02·리뷰 N6)", () => {
  it("늦어짐(slow)은 실패와 다른 한 줄로 보이고, 안내에 가려지지 않는다", () => {
    const wrapper = mount(SaveStatus, { props: { status: "slow", savedAt: 5, info: "안내" } });
    expect(wrapper.find(".status").text()).toBe("저장이 늦어지고 있어요…");
    expect(wrapper.find(".dot").classes()).toContain("slow");
    expect(wrapper.find(".dot").classes()).not.toContain("error");
    expect(wrapper.find(".time").exists()).toBe(false);
  });
});
