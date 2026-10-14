import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import TitleBar from "./TitleBar.vue";
import type { WindowControl } from "../platform/windowControl";

function fakeWindow() {
  return {
    setOpacity: vi.fn().mockResolvedValue(undefined),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  } satisfies WindowControl;
}

describe("TitleBar", () => {
  it("슬라이더를 움직이면 변환된 투명도로 창 투명도를 바꾼다", async () => {
    const win = fakeWindow();
    const wrapper = mount(TitleBar, { props: { windowControl: win, opacity: 100 } });

    await wrapper.find('input[type="range"]').setValue("50");

    expect(win.setOpacity).toHaveBeenLastCalledWith(expect.closeTo(0.6));
  });

  it("모아보기 버튼을 누르면 open-overview를 알린다", async () => {
    const wrapper = mount(TitleBar, { props: { windowControl: fakeWindow(), opacity: 100 } });

    await wrapper.find('[aria-label="모아보기"]').trigger("click");

    expect(wrapper.emitted("open-overview")).toHaveLength(1);
  });

  it("설정 버튼을 누르면 open-settings를 알린다", async () => {
    const wrapper = mount(TitleBar, { props: { windowControl: fakeWindow(), opacity: 100 } });

    await wrapper.find('[aria-label="설정"]').trigger("click");

    expect(wrapper.emitted("open-settings")).toHaveLength(1);
  });

  it("항상 위 버튼을 누르면 켜고 끄기가 바뀐다", async () => {
    const win = fakeWindow();
    const wrapper = mount(TitleBar, {
      props: {
        windowControl: win,
        opacity: 100,
        alwaysOnTop: true,
        "onUpdate:alwaysOnTop": (v: boolean) => wrapper.setProps({ alwaysOnTop: v }),
      },
    });
    const pin = wrapper.find('[aria-label="항상 위에 고정"]');
    expect(pin.attributes("aria-pressed")).toBe("true");

    await pin.trigger("click");
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    expect(pin.attributes("aria-pressed")).toBe("false");

    await pin.trigger("click");
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
  });
});
