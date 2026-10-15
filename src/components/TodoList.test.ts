import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import TodoList from "./TodoList.vue";
import type { TodoItem } from "../core/todoList";

function mountList(items: TodoItem[], extra: Record<string, unknown> = {}) {
  const wrapper = mount(TodoList, {
    props: {
      ...extra,
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

  it("↓ 는 다음 항목으로, 마지막 항목에서는 입력칸으로 커서를 옮긴다", async () => {
    const wrapper = mountList([
      { id: "a", text: "하나", done: false },
      { id: "b", text: "둘", done: false },
    ]);
    const texts = wrapper.findAll(".item .text");
    (texts[0].element as HTMLElement).focus();
    await texts[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(texts[1].element);
    await texts[1].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(wrapper.find(".add input").element);
  });

  it("↑ 는 이전 항목으로, 입력칸에서는 마지막 항목으로 커서를 옮긴다", async () => {
    const wrapper = mountList([
      { id: "a", text: "하나", done: false },
      { id: "b", text: "둘", done: false },
    ]);
    const input = wrapper.find(".add input");
    await input.trigger("keydown", { key: "ArrowUp" });
    const texts = wrapper.findAll(".item .text");
    expect(document.activeElement).toBe(texts[1].element);
    await texts[1].trigger("keydown", { key: "ArrowUp" });
    expect(document.activeElement).toBe(texts[0].element);
  });

  it("여러 줄을 붙여넣으면 첫 줄은 지금 항목에, 나머지는 아래 새 항목으로 들어간다", async () => {
    const wrapper = mountList([
      { id: "a", text: "하나", done: false },
      { id: "z", text: "끝", done: false },
    ]);
    const text = wrapper.find(".item .text");
    const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => " 붙임\n둘째\r\n\n셋째\n" },
    });
    text.element.dispatchEvent(event);
    await wrapper.vm.$nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(current(wrapper).map((t) => t.text)).toEqual(["하나 붙임", "둘째", "셋째", "끝"]);
  });

  it("어떤 경로로든 글자에 줄바꿈이 들어가면 공백으로 바꾼다", async () => {
    const wrapper = mountList([{ id: "a", text: "하나", done: false }]);
    const text = wrapper.find(".item .text");
    text.element.textContent = "하나\n둘";
    await text.trigger("input");
    expect(current(wrapper)[0].text).toBe("하나 둘");
    expect(text.element.textContent).toBe("하나 둘");
  });

  it("빈 입력칸에서 Backspace를 누르면 마지막 할 일 글자 끝으로 커서가 올라간다 (글자는 지우지 않는다)", async () => {
    const wrapper = mountList([
      { id: "a", text: "하나", done: false },
      { id: "b", text: "둘", done: false },
    ]);
    const input = wrapper.find(".add input");
    (input.element as HTMLInputElement).focus();

    await input.trigger("keydown", { key: "Backspace" });
    await wrapper.vm.$nextTick();

    expect(document.activeElement).toBe(wrapper.findAll(".item .text")[1].element);
    expect(current(wrapper).map((t) => t.text)).toEqual(["하나", "둘"]);
  });

  it("입력칸에 글자가 있거나 할 일이 하나도 없으면 Backspace는 평소대로 둔다", async () => {
    const filled = mountList([{ id: "a", text: "하나", done: false }]);
    const input = filled.find(".add input");
    await input.setValue("쓰는 중");
    (input.element as HTMLInputElement).focus();
    await input.trigger("keydown", { key: "Backspace" });
    expect(document.activeElement).toBe(input.element);

    const empty = mountList([]);
    const emptyInput = empty.find(".add input");
    (emptyInput.element as HTMLInputElement).focus();
    await emptyInput.trigger("keydown", { key: "Backspace" });
    expect(document.activeElement).toBe(emptyInput.element);
  });

  it("입력칸에 쓰다 만 글은 commitDraft로 할 일로 등록되고 입력칸은 비워진다", async () => {
    const wrapper = mountList([{ id: "a", text: "하나", done: false }]);
    const input = wrapper.find(".add input");
    await input.setValue("  쓰다 만 일 ");
    (wrapper.vm as unknown as { commitDraft: () => void }).commitDraft();
    await wrapper.vm.$nextTick();
    expect(current(wrapper).map((t) => t.text)).toEqual(["하나", "쓰다 만 일"]);
    expect((input.element as HTMLInputElement).value).toBe("");
  });

  it("입력칸이 비었으면 commitDraft는 아무것도 하지 않는다", async () => {
    const wrapper = mountList([{ id: "a", text: "하나", done: false }]);
    (wrapper.vm as unknown as { commitDraft: () => void }).commitDraft();
    await wrapper.vm.$nextTick();
    expect(current(wrapper).map((t) => t.text)).toEqual(["하나"]);
  });

  /** 항목 글자 안 offset 위치에 커서를 둔다 */
  function placeCaret(el: Element, offset: number) {
    (el as HTMLElement).focus();
    const range = document.createRange();
    range.setStart(el.firstChild ?? el, offset);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function caretOffset(el: Element) {
    const sel = window.getSelection()!;
    const range = sel.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  it("글자 중간에서 Enter를 누르면 커서 뒤 글자가 아래 새 할 일로 내려가고, 커서는 그 앞에 놓인다", async () => {
    const wrapper = mountList([
      { id: "a", text: "전자고지서 스테이지 배포하기", done: false },
      { id: "z", text: "끝", done: false },
    ]);
    const text = wrapper.find(".item .text");
    placeCaret(text.element, "전자고지서 스테이지".length);

    await text.trigger("keydown", { key: "Enter" });
    await wrapper.vm.$nextTick();

    expect(current(wrapper).map((t) => t.text)).toEqual(["전자고지서 스테이지", "배포하기", "끝"]);
    const second = wrapper.findAll(".item .text")[1].element;
    expect(document.activeElement).toBe(second);
    expect(caretOffset(second)).toBe(0);
  });

  it("체크한 할 일을 나누면 앞부분은 체크 그대로, 내려간 부분은 체크 안 된 새 할 일이다", async () => {
    const wrapper = mountList([{ id: "a", text: "보고서 작성 메일 발송", done: true }]);
    const text = wrapper.find(".item .text");
    placeCaret(text.element, "보고서 작성".length);
    await text.trigger("keydown", { key: "Enter" });
    expect(current(wrapper).map((t) => [t.text, t.done])).toEqual([
      ["보고서 작성", true],
      ["메일 발송", false],
    ]);
  });

  it("글자 맨 앞에서 Enter를 누르면 위에 빈 할 일이 생기고 커서는 원래 할 일에 남는다", async () => {
    const wrapper = mountList([{ id: "a", text: "장보기", done: true }]);
    const text = wrapper.find(".item .text");
    placeCaret(text.element, 0);
    await text.trigger("keydown", { key: "Enter" });
    await wrapper.vm.$nextTick();
    expect(current(wrapper).map((t) => [t.text, t.done])).toEqual([
      ["", false],
      ["장보기", true],
    ]);
    expect(document.activeElement).toBe(wrapper.findAll(".item .text")[1].element);
  });

  it("글자 맨 앞에서 Backspace를 누르면 위 할 일과 합쳐지고 커서는 이어 붙인 자리에 놓인다", async () => {
    const wrapper = mountList([
      { id: "a", text: "전자고지서 스테이지", done: false },
      { id: "b", text: "배포하기", done: false },
    ]);
    const text = wrapper.findAll(".item .text")[1];
    placeCaret(text.element, 0);
    await text.trigger("keydown", { key: "Backspace" });
    await wrapper.vm.$nextTick();
    expect(current(wrapper).map((t) => t.text)).toEqual(["전자고지서 스테이지 배포하기"]);
    const merged = wrapper.find(".item .text").element;
    expect(document.activeElement).toBe(merged);
    expect(caretOffset(merged)).toBe("전자고지서 스테이지 ".length);
  });

  describe("끝낸 일 아래로 보내기", () => {
    const list = () => [
      { id: "a", text: "하나", done: false },
      { id: "b", text: "둘", done: false },
      { id: "x", text: "끝낸 일", done: true },
    ];
    const order = (w: ReturnType<typeof mountList>) => current(w).map((t) => t.id);

    it("켜져 있으면 체크하고 0.5초 뒤 끝낸 일들의 맨 위로 옮긴다", async () => {
      vi.useFakeTimers();
      const wrapper = mountList(list(), { sortChecked: true });
      await wrapper.findAll(".item .box")[0].trigger("click");
      expect(current(wrapper)[0].done).toBe(true);
      await vi.advanceTimersByTimeAsync(400);
      expect(order(wrapper)).toEqual(["a", "b", "x"]);
      await vi.advanceTimersByTimeAsync(100);
      expect(order(wrapper)).toEqual(["b", "a", "x"]);
      vi.useRealTimers();
    });

    it("0.5초 안에 다시 누르면 옮기지 않고 체크도 풀린다", async () => {
      vi.useFakeTimers();
      const wrapper = mountList(list(), { sortChecked: true });
      const box = () => wrapper.findAll(".item .box")[0];
      await box().trigger("click");
      await vi.advanceTimersByTimeAsync(300);
      await box().trigger("click");
      await vi.advanceTimersByTimeAsync(2000);
      expect(order(wrapper)).toEqual(["a", "b", "x"]);
      expect(current(wrapper)[0].done).toBe(false);
      vi.useRealTimers();
    });

    it("체크를 풀면 0.5초 뒤 남은 일들의 맨 아래로 올라온다", async () => {
      vi.useFakeTimers();
      const wrapper = mountList([...list(), { id: "y", text: "또 끝낸 일", done: true }], { sortChecked: true });
      await wrapper.findAll(".item .box")[3].trigger("click");
      await vi.advanceTimersByTimeAsync(500);
      expect(order(wrapper)).toEqual(["a", "b", "y", "x"]);
      vi.useRealTimers();
    });

    it("꺼져 있으면 체크해도 그 자리에 둔다", async () => {
      vi.useFakeTimers();
      const wrapper = mountList(list(), { sortChecked: false });
      await wrapper.findAll(".item .box")[0].trigger("click");
      await vi.advanceTimersByTimeAsync(2000);
      expect(order(wrapper)).toEqual(["a", "b", "x"]);
      vi.useRealTimers();
    });
  });
});
