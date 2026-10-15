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

const TASK_LINE = /^[-*+] \[([ xX])\](?: (.*))?$/;
// 줄 끝 주석에 앱이 쓰는 표시를 모은다: from:날짜, ai:도구@시각.
// 날짜가 빈 "from:"은 "표시 없음"이다. 글자 자체가 이 주석처럼 끝날 때 그 글자를 지키려고 붙인다
const MARKER_COMMENT = /\s*<!--((?: (?:from:(?:\d{4}-\d{2}-\d{2})?|ai:[\w.-]+@\d+))+) -->\s*$/;
const INDENTED = /^\s+\S/;

function parseLine(line: string): TodoLine | null {
  const match = TASK_LINE.exec(line);
  if (!match) return null;
  const todo: TodoLine = { text: match[2] ?? "", done: match[1] !== " " };
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
      const tokens: string[] = [];
      if (todo.from) tokens.push(`from:${todo.from}`);
      if (todo.ai) tokens.push(`ai:${todo.ai.by}@${todo.ai.at}`);
      if (!tokens.length && MARKER_COMMENT.test(text)) tokens.push("from:");
      const marker = tokens.length ? ` <!-- ${tokens.join(" ")} -->` : "";
      const children = (todo.children ?? []).map((line) => `${line}\n`).join("");
      return `- [${todo.done ? "x" : " "}] ${text}${marker}\n${children}`;
    })
    .join("");
}
