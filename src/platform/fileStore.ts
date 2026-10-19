export interface WriteIfResult {
  ok: boolean;
  /** ok가 false일 때 지금 파일 내용(없으면 "") */
  current: string | null;
}

export interface FileStore {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  /**
   * 파일이 아직 expected(없으면 "")일 때만 쓴다. 다르면 쓰지 않고 지금 내용을 돌려준다. expected가 null이면 그냥 쓴다.
   * 읽고 쓰는 사이에 aru 명령·다른 창이 쓴 것을 덮어쓰지 않으려고 쓴다
   */
  writeIf?(path: string, content: string, expected: string | null): Promise<WriteIfResult>;
  /** 폴더 안 이름들. 폴더가 없으면 빈 목록 */
  list?(dir: string): Promise<string[]>;
}

const MAX_ATTEMPTS = 5;

/**
 * 파일을 읽어 change로 바꾼 내용을 쓴다. 그 사이 다른 곳이 파일을 바꿨으면 바뀐 내용으로 change를 다시 돌린다.
 * change가 null을 돌려주면 쓰지 않는다. 쓴 내용(쓰지 않았으면 null)을 돌려준다
 */
export async function updateFile(
  store: FileStore,
  path: string,
  change: (content: string) => string | null,
): Promise<string | null> {
  let content = (await store.read(path)) ?? "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const next = change(content);
    if (next === null) return null;
    if (!store.writeIf) {
      await store.write(path, next);
      return next;
    }
    const result = await store.writeIf(path, next, content);
    if (result.ok) return next;
    content = result.current ?? "";
  }
  throw `파일이 계속 바뀌고 있어 쓰지 못했어요: ${path}`;
}
