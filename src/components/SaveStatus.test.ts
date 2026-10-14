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
