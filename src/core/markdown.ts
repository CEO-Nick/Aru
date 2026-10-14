export interface TodoLine {
  text: string;
  done: boolean;
  /** 다른 날에서 넘어온 항목이 처음 등록된 날짜 (YYYY-MM-DD) */
  from?: string;
  /** 바로 아래 들여쓴 줄(하위 할 일·덧붙인 메모). 앱은 다루지 않고 항목과 함께 옮기고 그대로 쓴다 */
  children?: string[];
}

const TASK_LINE = /^[-*+] \[([ xX])\](?: (.*))?$/;
// 날짜가 빈 주석은 "넘어온 날짜 없음" 표시다. 글자 자체가 주석처럼 끝날 때 그 글자를 지키려고 붙인다
const FROM_COMMENT = /\s*<!-- from:(\d{4}-\d{2}-\d{2})? -->\s*$/;
const INDENTED = /^\s+\S/;

function parseLine(line: string): TodoLine | null {
  const match = TASK_LINE.exec(line);
  if (!match) return null;
  const todo: TodoLine = { text: match[2] ?? "", done: match[1] !== " " };
  const from = FROM_COMMENT.exec(todo.text);
  if (from) {
    todo.text = todo.text.slice(0, from.index);
    if (from[1]) todo.from = from[1];
  }
  return todo;
}

export function parseTodos(markdown: string): TodoLine[] {
  return parseDocument(markdown).todos;
}

export interface TodoDocument {
  todos: TodoLine[];
  /** 앱이 모르는 줄. 사용자가 다른 편집기에서 적은 메모를 잃지 않으려고 보관한다 */
  notes: string;
}

export function parseDocument(markdown: string): TodoDocument {
  const todos: TodoLine[] = [];
  const noteLines: string[] = [];
  let parent: TodoLine | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const todo = parseLine(line);
    if (todo) {
      todos.push(todo);
      parent = todo;
    } else if (parent && INDENTED.test(line)) {
      (parent.children ??= []).push(line);
    } else {
      noteLines.push(line);
      parent = null;
    }
  }
  return { todos, notes: noteLines.join("\n").replace(/^\n+|\n+$/g, "") };
}

export function serializeDocument(doc: TodoDocument): string {
  const todos = serializeTodos(doc.todos);
  if (!doc.notes) return todos;
  if (!todos) return `${doc.notes}\n`;
  return `${todos}\n${doc.notes}\n`;
}

export function serializeTodos(todos: TodoLine[]): string {
  return todos
    .filter((todo) => todo.text.trim() !== "" || todo.children?.length)
    .map((todo) => {
      const text = todo.text.replace(/\r?\n/g, " ");
      let marker = "";
      if (todo.from) marker = ` <!-- from:${todo.from} -->`;
      else if (FROM_COMMENT.test(text)) marker = " <!-- from: -->";
      const children = (todo.children ?? []).map((line) => `${line}\n`).join("");
      return `- [${todo.done ? "x" : " "}] ${text}${marker}\n${children}`;
    })
    .join("");
}
