import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TodoList from "./TodoList.vue";
import type { TodoItem } from "../core/todoList";

function mountList(items: TodoItem[]) {
  const wrapper = mount(TodoList, {
    props: {
      modelValue: items,
      "onUpdate:modelValue": (value: TodoItem[]) => wrapper.setProps({ modelValue: value }),
      placeholder: "새 할 일 입력",
    },
    attachTo: document.body,
  });
  return wrapper;
}

const current = (wrapper: ReturnType<typeof mountList>) =>
  wrapper.props("modelValue") as TodoItem[];

describe("TodoList", () => {
  it("항목의 글자와 완료 여부를 보여준다", () => {
    const wrapper = mountList([
      { id: "a", text: "장보기", done: false },
      { id: "b", text: "회의", done: true },
    ]);

    const items = wrapper.findAll(".item");
    expect(items.map((i) => i.find(".text").text())).toEqual(["장보기", "회의"]);
    expect(items.map((i) => i.classes("done"))).toEqual([false, true]);
  });

  it("체크박스를 누르면 완료 여부가 바뀐다", async () => {
    const wrapper = mountList([{ id: "a", text: "장보기", done: false }]);

    await wrapper.find(".item .box").trigger("click");

    expect(current(wrapper)[0].done).toBe(true);
  });

  it("글자를 고치면 그 항목의 글자가 바뀐다", async () => {
    const wrapper = mountList([{ id: "a", text: "장보기", done: false }]);
    const text = wrapper.find(".item .text");

    text.element.textContent = "장보기 (우유)";
    await text.trigger("input");

    expect(current(wrapper)[0].text).toBe("장보기 (우유)");
  });

  it("입력칸에서 Enter를 누르면 맨 끝에 할 일이 추가되고 입력칸은 비워진다", async () => {
    const wrapper = mountList([{ id: "a", text: "장보기", done: false }]);
    const input = wrapper.find(".add input");

    await input.setValue("회의 준비");
    await input.trigger("keydown", { key: "Enter" });

    expect(current(wrapper).map((t) => t.text)).toEqual(["장보기", "회의 준비"]);
    expect((input.element as HTMLInputElement).value).toBe("");
  });

  it("한글 조합 중에 누른 Enter로는 추가하지 않는다", async () => {
    const wrapper = mountList([]);
    const input = wrapper.find(".add input");

    await input.setValue("회의");
    await input.trigger("keydown", { key: "Enter", isComposing: true });

    expect(current(wrapper)).toEqual([]);
  });

  it("조합을 끝내는 Enter(keyCode 229)로도 추가하지 않는다", async () => {
    // 맥 WebKit은 조합을 확정하는 Enter를 isComposing=false, keyCode=229로 보낸다
    const wrapper = mountList([]);
    const input = wrapper.find(".add input");

    await input.setValue("회의");
    await input.trigger("keydown", { key: "Enter", keyCode: 229 });

    expect(current(wrapper)).toEqual([]);
  });

  it("입력칸에서 추가하면 입력칸이 보이도록 스크롤한다", async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    const wrapper = mountList([]);
    const input = wrapper.find(".add input");

    await input.setValue("회의");
    await input.trigger("keydown", { key: "Enter" });

    expect(scrolled).toContain(wrapper.find(".add").element);
  });

  it("항목에서 Enter를 누르면 바로 아래에 빈 항목이 생기고 커서가 그리로 간다", async () => {
    const wrapper = mountList([
      { id: "a", text: "하나", done: false },
      { id: "b", text: "둘", done: false },
    ]);

    await wrapper.findAll(".item .text")[0].trigger("keydown", { key: "Enter" });
    await wrapper.vm.$nextTick();

    expect(current(wrapper).map((t) => t.text)).toEqual(["하나", "", "둘"]);
    expect(document.activeElement).toBe(wrapper.findAll(".item .text")[1].element);
  });

  it("빈 항목에서 Backspace를 누르면 지워지고 커서가 위 항목으로 간다", async () => {
    const wrapper = mountList([
      { id: "a", text: "하나", done: false },
      { id: "b", text: "", done: false },
    ]);

    await wrapper.findAll(".item .text")[1].trigger("keydown", { key: "Backspace" });
    await wrapper.vm.$nextTick();

    expect(current(wrapper).map((t) => t.text)).toEqual(["하나"]);
    expect(document.activeElement).toBe(wrapper.findAll(".item .text")[0].element);
  });

  it("다른 날에서 넘어온 항목은 꼬리표를 보여주고, 누르면 꼬리표가 지워진다", async () => {
    const wrapper = mountList([{ id: "a", text: "PR 리뷰", done: false, from: "2026-10-12" }]);

    const tag = wrapper.find(".item .from");
    expect(tag.text()).toBe("10/12에서 넘어옴");

    await tag.trigger("click");

    expect(current(wrapper)[0].from).toBeUndefined();
    expect(wrapper.find(".item .from").exists()).toBe(false);
  });

  it("손잡이를 누르면 그 항목의 드래그 시작을 알린다", async () => {
    const wrapper = mountList([{ id: "a", text: "하나", done: false }]);

    await wrapper.find(".item .grip").trigger("pointerdown");

    expect(wrapper.emitted("drag-start")?.[0]?.[0]).toBe("a");
  });

  it("놓일 자리가 이 목록의 어떤 항목 앞이면 그 항목에 표시한다", async () => {
    const wrapper = mountList([
      { id: "a", text: "하나", done: false },
      { id: "b", text: "둘", done: false },
    ]);

    await wrapper.setProps({ listKey: "today", marker: { listKey: "today", beforeId: "b" } });

    const rows = wrapper.findAll(".item");
    expect(rows.map((r) => r.classes("drop-before"))).toEqual([false, true]);
  });

  it("놓일 자리가 이 목록의 맨 끝이면 입력칸 위에 표시한다", async () => {
    const wrapper = mountList([{ id: "a", text: "하나", done: false }]);

    await wrapper.setProps({ listKey: "today", marker: { listKey: "today", beforeId: null } });

    expect(wrapper.find(".add").classes("drop-before")).toBe(true);
  });
});
