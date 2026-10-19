export interface TodoLine {
  text: string;
  done: boolean;
  /** 다른 날에서 넘어온 항목이 처음 등록된 날짜 (YYYY-MM-DD) */
  from?: string;
  /** AI·명령어가 넣고 사용자가 아직 손대지 않은 할 일. by는 넣은 도구, at은 넣은 시각(유닉스 초) */
  ai?: { by: string; at: number };
  /** 바로 아래 들여쓴 줄(하위 할 일·덧붙인 메모). 앱은 다루지 않고 항목과 함께 옮기고 그대로 쓴다 */
  children?: string[];
}

import { isBlankTodoText, normalizeTodoText } from "./text";

// 파일은 \n(또는 \r\n)으로만 줄을 나눈다. 글자 속 U+2028·U+2029·CR이 줄 끝으로 읽히면 할 일이 메모가 되어 사라진다
const TASK_LINE = /^[-*+] \[([ xX])\](?: (.*))?$/s;
// 줄 끝 주석에 앱이 쓰는 표시를 모은다: from:날짜, ai:도구@시각.
// 날짜가 빈 "from:"은 "표시 없음"이다. 글자 자체가 이 주석처럼 끝날 때 그 글자를 지키려고 붙인다.
// 주석 앞 공백은 앱이 쓰는 한 칸만 떼어 낸다. 더 떼면 글자의 끝 공백이 다시 읽을 때 사라진다
const MARKER_COMMENT = / ?<!--((?: (?:from:(?:\d{4}-\d{2}-\d{2})?|ai:[\w.-]+@\d+))+) -->\s*$/;
const INDENTED = /^\s+\S/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;

function parseLine(line: string): TodoLine | null {
  const match = TASK_LINE.exec(line);
  if (!match) return null;
  const todo: TodoLine = { text: normalizeTodoText(match[2] ?? ""), done: match[1] !== " " };
  const marker = MARKER_COMMENT.exec(todo.text);
  if (marker) {
    todo.text = todo.text.slice(0, marker.index);
    for (const token of marker[1].trim().split(" ")) {
      if (token.startsWith("from:") && token.length > 5) todo.from = token.slice(5);
      if (token.startsWith("ai:")) {
        const [by, at] = token.slice(3).split("@");
        todo.ai = { by, at: Number(at) };
      }
    }
  }
  return todo;
}

export function parseTodos(markdown: string): TodoLine[] {
  return parseDocument(markdown).todos;
}

/**
 * 할 일이 아닌 줄을 원래 자리에 되돌려 쓰기 위한 정보. 할 일 순서는 앱이 바꾸므로 줄의 자리를 이렇게 정한다.
 * - header: 첫 할 일 위의 줄(제목 등). 늘 맨 위에 남고, 맨 위에 넣는 할 일은 그 아래로 간다
 * - gaps: 할 일 사이의 줄. 바로 뒤 할 일에 붙어 그 할 일과 함께 움직인다(소제목은 아래 할 일의 것이므로).
 *   붙을 할 일은 id(화면 항목)로 먼저 찾고, id가 없으면 글자(anchor)가 같은 것 중 완료 상태가 같고 원래 순번(index)에
 *   가장 가까운 것으로 찾는다. 같은 글자의 할 일이 여럿이어도 엉뚱한 쪽에 붙지 않게 하려는 것이다.
 *   그 할 일이 지워져 찾을 수 없으면 원래 순번 자리의 할 일 앞에 둔다. 줄은 어떤 경우에도 지우지 않는다
 * - 마지막 할 일 아래 줄은 TodoDocument.notes. footerGap은 그 사이 빈 줄 수(없으면 1)
 * - styles: 손대지 않은 할 일 줄의 원래 모양(* 기호, 대문자 X, 글자 속 NBSP·CR 등). 앱 형식으로 쓴 줄 → 원래 줄.
 *   빈 할 일(보이지 않는 글자뿐) 줄은 모양이 같아도 남긴다. 앱은 빈 칸을 쓰지 않지만 다른 편집기가 쓴 줄은 이 개수만큼 지키려고
 * - 줄 끝: 있던 줄은 제 줄 끝을 그대로 쓰고, 새로 쓰는 줄(새 할 일·고친 할 일)은 파일에 많은 쪽을 따른다(aru 명령과 같은 규칙).
 *   crlf는 \r\n이 줄의 절반을 넘는다는 뜻(같으면 \n), otherEol은 많은 쪽과 다른 끝을 가진 줄(글자 → 개수)
 */
export interface DocumentLayout {
  bom?: true;
  crlf?: true;
  otherEol?: Record<string, number>;
  header?: string[];
  gaps?: { anchor: string; done?: boolean; index: number; lines: string[]; id?: string }[];
  footerGap?: number;
  styles?: Record<string, string[]>;
}

export interface TodoDocument {
  /** id가 있으면(화면 항목) 사이 줄을 그 id에 붙인다 */
  todos: (TodoLine & { id?: string })[];
  /** 마지막 할 일 아래의 앱이 모르는 줄. 사용자가 다른 편집기에서 적은 메모를 잃지 않으려고 보관한다 */
  notes: string;
  layout?: DocumentLayout;
}

export function parseDocument(markdown: string): TodoDocument {
  const bom = markdown.startsWith("\ufeff");
  const body = bom ? markdown.slice(1) : markdown;
  const lines = body.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const closers = fenceClosersAfter(lines);
  const todos: TodoLine[] = [];
  const layout: DocumentLayout = {};
  let pending: string[] = [];
  let parent: TodoLine | null = null;
  // 코드 블록 안은 할 일 모양이어도 예시 글이다. 블록이 할 일의 하위 줄로 시작했으면 끝까지 그 할 일에 붙인다
  let fence: { mark: string; child: boolean } | null = null;

  lines.forEach((line, i) => {
    if (fence) {
      if (fence.child && parent) (parent.children ??= []).push(line);
      else pending.push(line);
      if (closesFence(line, fence.mark)) fence = null;
      return;
    }
    // 닫는 줄이 뒤에 없는 펜스는 펜스가 아니다. 그렇게 보면 그 아래 할 일이 모두 사라진다
    const mark = FENCE_OPEN.exec(line)?.[1];
    const open = mark && closers[i][mark[0] === "`" ? 0 : 1] >= mark.length ? mark : undefined;
    const todo = open ? null : parseLine(line);
    if (todo) {
      if (!todos.length) {
        if (pending.length) layout.header = pending;
      } else if (pending.length) {
        (layout.gaps ??= []).push({ anchor: todo.text, done: todo.done, index: todos.length, lines: pending });
      }
      pending = [];
      recordStyle(layout, line, todo);
      todos.push(todo);
      parent = todo;
    } else if (parent && INDENTED.test(line)) {
      (parent.children ??= []).push(line);
      if (open) fence = { mark: open, child: true };
    } else {
      pending.push(line);
      parent = null;
      if (open) fence = { mark: open, child: false };
    }
  });

  let gap = 0;
  while (gap < pending.length && pending[gap] === "") gap++;
  let end = pending.length;
  while (end > gap && pending[end - 1] === "") end--;
  const notes = pending.slice(gap, end).join("\n");
  if (todos.length && notes && gap !== 1) layout.footerGap = gap;
  if (bom) layout.bom = true;
  recordEndings(layout, body);
  return Object.keys(layout).length ? { todos, notes, layout } : { todos, notes };
}

function recordEndings(layout: DocumentLayout, body: string) {
  const segments = body.split("\n");
  const terminated = segments.length - 1;
  if (segments[terminated] === "") segments.pop();
  const ends = segments.map((seg, k) => (k < terminated ? (seg.endsWith("\r") ? "\r\n" : "\n") : ""));
  const crlf = ends.filter((e) => e === "\r\n").length * 2 > segments.length;
  const other = crlf ? "\n" : "\r\n";
  const odd: Record<string, number> = {};
  segments.forEach((seg, k) => {
    if (ends[k] !== other) return;
    const text = seg.endsWith("\r") ? seg.slice(0, -1) : seg;
    odd[text] = (odd[text] ?? 0) + 1;
  });
  if (crlf) layout.crlf = true;
  if (Object.keys(odd).length) layout.otherEol = odd;
}

const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

function closesFence(line: string, mark: string): boolean {
  const match = FENCE_CLOSE.exec(line);
  return !!match && match[1][0] === mark[0] && match[1].length >= mark.length;
}

/** 줄마다, 그 뒤에 오는 닫는 줄의 가장 긴 ``` 길이와 ~~~ 길이 */
function fenceClosersAfter(lines: string[]): [number, number][] {
  const after: [number, number][] = new Array(lines.length);
  let ticks = 0;
  let tildes = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    after[i] = [ticks, tildes];
    const match = FENCE_CLOSE.exec(lines[i]);
    if (match && match[1][0] === "`") ticks = Math.max(ticks, match[1].length);
    else if (match) tildes = Math.max(tildes, match[1].length);
  }
  return after;
}

function recordStyle(layout: DocumentLayout, line: string, todo: TodoLine) {
  const canonical = todoLine(todo);
  if (line === canonical && isWritten(todo)) return;
  // 손대지 않은 줄은 원래 모양(* 기호, 대문자 X, 글자 속 NBSP·CR 등) 그대로 다시 쓴다. aru 명령도 있던 줄을 바꾸지 않는다
  ((layout.styles ??= {})[canonical] ??= []).push(line);
}

function todoLine(todo: TodoLine): string {
  const text = normalizeTodoText(todo.text);
  const tokens: string[] = [];
  if (todo.from) tokens.push(`from:${todo.from}`);
  if (todo.ai) tokens.push(`ai:${todo.ai.by}@${todo.ai.at}`);
  if (!tokens.length && MARKER_COMMENT.test(text)) tokens.push("from:");
  const marker = tokens.length ? ` <!-- ${tokens.join(" ")} -->` : "";
  return `- [${todo.done ? "x" : " "}] ${text}${marker}`;
}

const isWritten = (todo: TodoLine) => !isBlankTodoText(todo.text) || !!todo.children?.length;

export function serializeDocument(doc: TodoDocument): string {
  const layout = doc.layout ?? {};
  const untouchedBlanks = new Map(Object.entries(layout.styles ?? {}).map(([k, v]) => [k, v.length]));
  const todos = doc.todos.filter((todo) => {
    if (isWritten(todo)) return true;
    const canonical = todoLine(todo);
    const left = untouchedBlanks.get(canonical) ?? 0;
    untouchedBlanks.set(canonical, left - 1);
    return left > 0;
  });
  const before: string[][] = todos.map(() => []);
  const trailing: string[] = [];
  const orphans: string[][] = todos.map(() => []);
  const gaps = layout.gaps ?? [];
  const slots = anchorGaps(gaps, todos);
  gaps.forEach((gap, k) => {
    if (slots[k] !== -1) before[slots[k]].push(...gap.lines);
    else if (gap.index < todos.length) orphans[gap.index].push(...gap.lines);
    else trailing.push(...gap.lines);
  });

  const styles = new Map(Object.entries(layout.styles ?? {}).map(([k, v]) => [k, [...v]]));
  const lines = [...(layout.header ?? [])];
  todos.forEach((todo, i) => {
    const canonical = todoLine(todo);
    lines.push(...orphans[i], ...before[i], styles.get(canonical)?.shift() ?? canonical, ...(todo.children ?? []));
  });
  lines.push(...trailing);
  if (doc.notes) {
    if (lines.length) lines.push(...Array<string>(layout.footerGap ?? 1).fill(""));
    lines.push(...doc.notes.split("\n"));
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (!lines.length) return "";
  const eol = layout.crlf ? "\r\n" : "\n";
  const odd = { ...layout.otherEol };
  const end = (line: string) => {
    if (!odd[line]) return eol;
    odd[line]--;
    return eol === "\n" ? "\r\n" : "\n";
  };
  return `${layout.bom ? "\ufeff" : ""}${lines.map((line) => line + end(line)).join("")}`;
}

/** 사이 줄마다 붙을 할 일의 자리(없으면 -1). 한 할 일에는 한 묶음만 붙는다 */
function anchorGaps(gaps: NonNullable<DocumentLayout["gaps"]>, todos: TodoDocument["todos"]): number[] {
  const slots = gaps.map(() => -1);
  const taken = new Set<number>();
  const byId = new Map<string, number>();
  todos.forEach((t, i) => t.id !== undefined && byId.set(t.id, i));
  gaps.forEach((gap, k) => {
    const i = gap.id === undefined ? undefined : byId.get(gap.id);
    if (i !== undefined && !taken.has(i)) {
      slots[k] = i;
      taken.add(i);
    }
  });
  const byText = new Map<string, number[]>();
  todos.forEach((t, i) => {
    const text = normalizeTodoText(t.text);
    (byText.get(text) ?? byText.set(text, []).get(text)!).push(i);
  });
  gaps.forEach((gap, k) => {
    // id로 붙던 할 일이 사라졌으면 같은 글자의 다른 할 일이 아니라 원래 순번 자리로 간다
    if (gap.id !== undefined) return;
    let best = -1;
    let bestScore = Infinity;
    for (const i of byText.get(gap.anchor) ?? []) {
      if (taken.has(i)) continue;
      const score = (gap.done !== undefined && todos[i].done !== gap.done ? todos.length + 1 : 0) + Math.abs(i - gap.index);
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best !== -1) {
      slots[k] = best;
      taken.add(best);
    }
  });
  return slots;
}

export function serializeTodos(todos: TodoLine[]): string {
  return serializeDocument({ todos, notes: "" });
}
