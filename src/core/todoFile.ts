import { parseDocument, serializeDocument, type DocumentLayout } from "./markdown";
import { mergeContent } from "./merge";
import { isBlankTodoText, normalizeTodoText } from "./text";
import type { TodoItem } from "./todoList";

declare const docTailBrand: unique symbol;

/**
 * 파일에서 할 일 목록 말고 나머지(메모, 제목·소제목 자리, BOM·CRLF, 목록 기호). 화면 쪽은 들고 있다가
 * dumpItems에 그대로 돌려주기만 한다. 직접 만들거나 문자열과 섞어 쓸 수 없게 막아 둔다
 */
export interface DocTail {
  readonly [docTailBrand]: true;
  readonly notes: string;
  readonly layout?: DocumentLayout;
}

const tail = (notes: string, layout?: DocumentLayout) => (layout ? { notes, layout } : { notes }) as unknown as DocTail;

export const EMPTY_TAIL = tail("");

export function parseItems(markdown: string, newId: () => string): { items: TodoItem[]; doc: DocTail } {
  const parsed = parseDocument(markdown);
  const items = parsed.todos.map((todo) => ({ id: newId(), ...todo }));
  const layout = parsed.layout?.gaps
    ? { ...parsed.layout, gaps: parsed.layout.gaps.map((gap) => ({ ...gap, id: items[gap.index].id })) }
    : parsed.layout;
  return { items, doc: tail(parsed.notes, layout) };
}

export function dumpItems(items: TodoItem[], doc: DocTail): string {
  return serializeDocument({ todos: items, notes: doc.notes, layout: doc.layout });
}

/** 다시 읽으며 항목 id를 이전 것으로 바꿨으면 사이 줄도 바뀐 id를 따라가게 한다 */
export function renameIds(doc: DocTail, rename: Map<string, string>): DocTail {
  const gaps = doc.layout?.gaps;
  if (!gaps) return doc;
  return tail(doc.notes, { ...doc.layout, gaps: gaps.map((gap) => ({ ...gap, id: rename.get(gap.id!) ?? gap.id })) });
}

/**
 * 앱이 읽고 쓴 형태로 맞춘 파일 내용. 내 쪽은 늘 이 형태라, base·저쪽도 맞춰야 NBSP 같은 차이를 고친 줄로 오해하지 않는다.
 * 줄 끝(CRLF)과 BOM은 떼고 맞춘다 — 다른 편집기가 줄 끝만 바꿔 저장하면 모든 줄이 "고친 줄"로 보여 할 일이 둘이 된다
 */
function canonical(content: string): { text: string; layout?: DocumentLayout } {
  const doc = parseDocument(content);
  if (!doc.layout) return { text: serializeDocument(doc) };
  const { bom: _bom, crlf: _crlf, otherEol: _otherEol, ...rest } = doc.layout;
  return { text: serializeDocument({ ...doc, layout: rest }), layout: doc.layout };
}

/**
 * 할 일 파일을 줄 단위로 합친다. 세 쪽을 같은 형태로 맞춘 뒤 합치고, 줄 끝과 BOM은 지금 파일(저쪽)의 것을 입힌다.
 * 있던 줄은 지금 파일에서의 제 줄 끝을, 새 줄은 지금 파일에 많은 쪽을 따른다. 저쪽이 비었으면 내 쪽 것을 쓴다
 */
export function mergeTodoContent(base: string, mine: string, theirs: string): string {
  const t = canonical(theirs);
  const m = canonical(mine);
  const merged = parseDocument(mergeContent(canonical(base).text, m.text, t.text));
  const endings = (t.text ? t : m).layout;
  const layout: DocumentLayout = { ...merged.layout };
  if (endings?.bom) layout.bom = true;
  if (endings?.crlf) layout.crlf = true;
  if (endings?.otherEol) layout.otherEol = endings.otherEol;
  return serializeDocument({ ...merged, layout });
}

/**
 * 경로에 맞는 방법으로 합친다. 할 일 파일이 아니면(settings.json) 합치지 않고 내 내용을 쓴다 —
 * JSON을 줄 단위로 합치면 깨지고, 설정은 마지막에 바꾼 쪽이 이겨도 된다.
 * 설정은 base 없이 예약하고, 자동저장은 base 없는 저장에 base를 붙이지 않으며(이어진 저장의 기준 옮기기 포함)
 * rebaseAll도 .md에만 붙이므로 .md가 아닌 파일은 여기 오지 않는다.
 * 그래도 남겨 두는 건 누가 설정에 base를 붙이는 순간 JSON이 조용히 깨지는 것을 막는 방어선이라서다
 */
export function mergeFile(path: string, base: string, mine: string, theirs: string): string {
  return path.endsWith(".md") ? mergeTodoContent(base, mine, theirs) : mine;
}

/**
 * 빠른 입력창에서 쓴 할 일은 맨 위(첫 할 일 앞, 제목 아래)에 넣는다. 다른 앱을 쓰다 적은 일이라 창을 보면 바로 보여야 한다.
 * 같은 날 안 끝낸 똑같은 할 일이 있거나 글자가 비었으면 넣지 않고 skipped로 알린다(aru 명령과 같은 규칙)
 */
export function prependTodoIfNew(markdown: string, text: string): { content: string; skipped: boolean } {
  const clean = normalizeTodoText(text).trim();
  const doc = parseDocument(markdown);
  if (isBlankTodoText(clean) || doc.todos.some((todo) => !todo.done && todo.text.trim() === clean)) {
    return { content: markdown, skipped: true };
  }
  return { content: serializeDocument({ ...doc, todos: [{ text: clean, done: false }, ...doc.todos] }), skipped: false };
}
