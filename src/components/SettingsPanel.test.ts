import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SettingsPanel from "./SettingsPanel.vue";

const mountPanel = () =>
  mount(SettingsPanel, {
    props: { carryOver: "keep", dataRoot: "/Users/me/Library/Application Support/x" },
  });

describe("SettingsPanel", () => {
  it("미완료 처리 세 가지를 보여주고 지금 값이 선택돼 있다", () => {
    const wrapper = mountPanel();
    const options = wrapper.findAll(".radio");
    expect(options.map((o) => o.find("b").text())).toEqual([
      "그 날짜에 그대로 남기기",
      "다음 날로 옮기기",
      "언젠가로 옮기기",
    ]);
    expect(options.map((o) => o.attributes("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("다른 방식을 누르면 그 값으로 바꾼다", async () => {
    const wrapper = mountPanel();
    await wrapper.findAll(".radio")[1].trigger("click");
    expect(wrapper.emitted("update:carryOver")).toEqual([["next-day"]]);
  });

  it("저장 폴더를 보여주고, 변경·열기 버튼이 알린다", async () => {
    const wrapper = mountPanel();
    expect(wrapper.find(".path").text()).toBe("/Users/me/Library/Application Support/x");
    await wrapper.find('[data-action="change-folder"]').trigger("click");
    await wrapper.find('[data-action="reveal-folder"]').trigger("click");
    expect(wrapper.emitted("change-folder")).toHaveLength(1);
    expect(wrapper.emitted("reveal-folder")).toHaveLength(1);
  });

  it("닫기 버튼을 누르면 목록으로 돌아가라고 알린다", async () => {
    const wrapper = mountPanel();
    await wrapper.find('[data-action="close"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
