export interface TodoLine {
  text: string;
  done: boolean;
  /** 다른 날에서 넘어온 항목이 처음 등록된 날짜 (YYYY-MM-DD) */
  from?: string;
}

const TASK_LINE = /^[-*+] \[([ xX])\] (.*)$/;
const FROM_COMMENT = /\s*<!-- from:(\d{4}-\d{2}-\d{2}) -->\s*$/;

function parseLine(line: string): TodoLine | null {
  const match = TASK_LINE.exec(line);
  if (!match) return null;
  const todo: TodoLine = { text: match[2], done: match[1] !== " " };
  const from = FROM_COMMENT.exec(todo.text);
  if (from) {
    todo.text = todo.text.slice(0, from.index);
    todo.from = from[1];
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
  for (const line of markdown.split(/\r?\n/)) {
    const todo = parseLine(line);
    if (todo) todos.push(todo);
    else noteLines.push(line);
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
    .map((todo) => {
      const from = todo.from ? ` <!-- from:${todo.from} -->` : "";
      const text = todo.text.replace(/\r?\n/g, " ");
      return `- [${todo.done ? "x" : " "}] ${text}${from}\n`;
    })
    .join("");
}
