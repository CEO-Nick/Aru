import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DateBar from "./DateBar.vue";

function mountBar(date: string, today = "2026-10-14") {
  return mount(DateBar, { props: { date, today } });
}

describe("DateBar", () => {
  it("◀ ▶ 로 하루씩 이동한다", async () => {
    const wrapper = mountBar("2026-10-14");
    await wrapper.find('[aria-label="이전 날"]').trigger("click");
    await wrapper.find('[aria-label="다음 날"]').trigger("click");
    expect(wrapper.emitted("update:date")).toEqual([["2026-10-13"], ["2026-10-15"]]);
  });

  it("오늘을 보고 있으면 꼬리표가 없고 오늘 버튼이 강조되지 않는다", () => {
    const wrapper = mountBar("2026-10-14");
    expect(wrapper.find(".tag").exists()).toBe(false);
    expect(wrapper.find(".today-btn").classes("hot")).toBe(false);
  });

  it("지난 날짜면 '지난 날짜', 미래면 '예정' 꼬리표를 붙이고 오늘 버튼을 강조한다", () => {
    const past = mountBar("2026-10-13");
    expect(past.find(".tag").text()).toBe("지난 날짜");
    expect(past.find(".today-btn").classes("hot")).toBe(true);
    expect(mountBar("2026-10-16").find(".tag").text()).toBe("예정");
  });

  it("오늘 버튼을 누르면 오늘로 돌아간다", async () => {
    const wrapper = mountBar("2026-10-01");
    await wrapper.find(".today-btn").trigger("click");
    expect(wrapper.emitted("update:date")).toEqual([["2026-10-14"]]);
  });

  it("날짜 글자를 누르면 달력을 열어 달라고 알린다", async () => {
    const wrapper = mountBar("2026-10-14");
    await wrapper.find(".date").trigger("click");
    expect(wrapper.emitted("open-calendar")).toHaveLength(1);
  });
});
