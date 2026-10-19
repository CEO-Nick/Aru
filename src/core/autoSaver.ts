import type { FileStore } from "../platform/fileStore";
import { mergeFile } from "./todoFile";

export type SaveMode = "debounce" | "now";
/** slow: flush가 상한까지 기다려도 응답이 없는 쓰기가 있다. 실패가 아니라 아직 쓰는 중이다 */
export type SaveStatus = "saved" | "pending" | "error" | "slow";

const DEBOUNCE_MS = 1000;
const RETRY_MS = 5000;
const MAX_MERGES = 5;
/** flush 한 번이 기다리는 상한(파일 수와 상관없이 전체). 끊긴 네트워크 폴더에서 응답이 영영 안 와도 날짜 이동·창 닫기가 묶이지 않게 */
const FLUSH_WAIT_MS = 10_000;

/** 쓸 내용과, 그 내용을 만들 때 파일에 있다고 알던 내용(base). base가 없으면 확인 없이 쓴다 */
export interface PendingWrite {
  content: string;
  base?: string;
  /**
   * 화면이 처음 예약한 내용. 충돌로 합친 쓰기가 실패해 재시도로 남으면 content는 합친 것이 되지만,
   * 다 쓴 뒤 화면에 알릴 때는 이 값을 넘겨야 화면이 모르는 합친 줄을 들인다
   */
  scheduled?: string;
  /**
   * 쓰기 직전(기다림이 끝났거나 flush가 부를 때)에 쓸 내용을 다시 만든다. 다시 읽기를 쓰기에 포함시켜야
   * 끄기 기다림 동안 바뀐 파일을 반영하고, 종료 저장도 그 다시 읽기를 기다린다(QA13 B1·B2)
   */
  prepare?: () => Promise<string>;
}

/** 지금 쓰고 있는 저장. 충돌로 합쳐 다시 쓰면 content·base가 바뀐다 */
interface Inflight extends PendingWrite {
  promise: Promise<boolean>;
}

const isTodoFile = (path: string) => path.endsWith(".md");

export class AutoSaver {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Map<string, PendingWrite>();
  private inflight = new Map<string, Inflight>();
  private listeners: ((status: SaveStatus) => void)[] = [];
  private writeListeners: ((path: string, written: string, scheduled: string) => void)[] = [];
  /** flush 상한을 넘기고도 아직 응답이 없는 쓰기의 파일 */
  private slow = new Set<string>();
  /**
   * 마지막 쓰기가 실패하고 아직 성공한 쓰기가 없는 파일. 기다리는 저장에 붙이면 같은 파일을 이어 고칠 때(schedule이 그 저장을 바꿀 때)
   * 실패 표시도 함께 사라져 재시도가 계속 실패하는 동안 "기다리는 중"으로 가려진다
   */
  private failed = new Set<string>();

  constructor(private readonly store: FileStore) {}

  onStatus(listener: (status: SaveStatus) => void): void {
    this.listeners.push(listener);
  }

  /**
   * base를 주면 파일이 아직 base일 때만 쓴다. 그 사이 다른 곳(aru 명령·다른 편집기)이 바꿨으면 base·내 내용·지금 파일을
   * 3-way로 합쳐 쓴다. 저장 직전까지 기다렸다 쓰는 동안 들어온 변경을 덮어쓰지 않으려는 것이다
   */
  schedule(path: string, content: string, mode: SaveMode, base?: string, prepare?: () => Promise<string>): void {
    clearTimeout(this.timers.get(path));
    this.timers.delete(path);
    this.pending.set(path, { content, ...(base !== undefined && { base }), ...(prepare && { prepare }) });
    this.emit(this.busyStatus());
    if (mode === "now") {
      void this.save(path);
    } else {
      this.timers.set(
        path,
        setTimeout(() => void this.save(path), DEBOUNCE_MS),
      );
    }
  }

  /** 파일에 실제로 쓴 뒤 알린다. 합쳐서 썼으면 written이 scheduled와 다르다 */
  onWrite(listener: (path: string, written: string, scheduled: string) => void): void {
    this.writeListeners.push(listener);
  }

  /** 아직 쓰지 못했거나 쓰는 중인 내용이 있는가. 쓰는 중인 것도 넣어야 다시 읽은 파일로 그 편집을 덮지 않는다 */
  hasPending(path: string): boolean {
    return this.pending.has(path) || this.inflight.has(path);
  }

  /** 아직 쓰지 못한 내용(없으면 쓰는 중인 내용). 저장 폴더를 열 수 없는 동안 다른 날로 갔다 돌아온 경우 등 */
  pendingFor(path: string): PendingWrite | undefined {
    const entry = this.pending.get(path) ?? this.inflight.get(path);
    if (!entry) return undefined;
    return entry.base === undefined ? { content: entry.content } : { content: entry.content, base: entry.base };
  }

  /** 기다리는 저장을 쓰지 않고 버린다. 이미 쓰는 중인 것은 그대로 끝난다 */
  discard(path: string): void {
    clearTimeout(this.timers.get(path));
    this.timers.delete(path);
    this.pending.delete(path);
    if (!this.inflight.has(path)) this.failed.delete(path);
  }

  idle(): boolean {
    return this.pending.size === 0 && this.inflight.size === 0;
  }

  /**
   * 할 일 파일(.md) 저장의 기준을 모두 바꾼다. 저장 폴더가 바뀌었으면 옛 폴더 내용은 새 폴더 파일의 기준이 될 수 없다.
   * ""로 두면 새 폴더 파일과 합집합으로 합쳐 어느 쪽 줄도 지우지 않는다. 설정(JSON)은 줄 단위로 합치면 안 되므로 그대로 둔다
   */
  rebaseAll(base: string): void {
    for (const map of [this.pending, this.inflight] as Map<string, PendingWrite>[]) {
      for (const [path, entry] of map) if (isTodoFile(path)) entry.base = base;
    }
  }

  /**
   * 기다리는 저장을 모두 쓰고, 이미 쓰는 중인 저장(충돌로 합쳐 다시 쓰는 것까지)도 끝날 때까지 기다린다.
   * 종료·새로고침 직전에 부르므로, 쓰는 중인 저장을 두고 끝나면 충돌 재시도가 사라진 창과 함께 없어진다.
   * 이번 flush에서 실패한 파일은 다시 시도하지 않는다(5초 뒤 재시도에 맡긴다).
   * 모두 썼으면 true. 실패했거나 상한까지 응답이 없으면 false — 응답 없는 쓰기는 버리지 않고, 끝나면 뒤에 줄 선 저장을 이어 쓴다.
   * 이미 상한을 넘긴(slow) 파일은 다시 기다리지 않는다. 끊긴 폴더에서 날짜를 옮길 때마다 10초씩 묶이지 않게.
   * only를 주면 그 파일만 쓴다(날짜를 옮길 때 떠나는 파일)
   */
  async flush(only?: string): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), FLUSH_WAIT_MS)));
    const failed = new Set<string>();
    const stuck = () => (only === undefined ? this.slow.size > 0 : this.slow.has(only));
    let paths: string[] = [];
    try {
      // 쓴 직후 화면이 합친 내용을 다시 예약하면(onWrite) 그것까지 쓴다. 계속 바뀌는 파일에 묶이지 않게 횟수를 둔다
      for (let round = 0; round < 4; round++) {
        paths = [...new Set([...this.inflight.keys(), ...this.pending.keys()])].filter(
          (p) => !failed.has(p) && !this.slow.has(p) && (only === undefined || p === only),
        );
        if (!paths.length) break;
        const all = Promise.all(
          paths.map(async (path) => {
            if (!(await this.save(path))) failed.add(path);
          }),
        );
        if ((await Promise.race([all, late])) === "late") {
          // 기다린 파일만 늦어짐이다. 기다리지 않은 파일까지 넣으면 다음 flush(종료 등)가 그 쓰기를 건너뛴다
          for (const path of paths) if (this.inflight.has(path)) this.slow.add(path);
          this.emit("slow");
          return false;
        }
      }
    } finally {
      clearTimeout(timer);
    }
    return failed.size === 0 && !stuck();
  }

  /** 쓰는 중인가. 응답 전이면 그 내용이 이미 파일에 들어갔는지 모른다 */
  writing(path: string): boolean {
    return this.inflight.has(path);
  }

  /** 같은 파일은 앞 저장이 끝난 뒤에 쓴다. 앞 저장이 합쳐 쓴 결과를 뒤 저장이 모른 채 덮지 않게 한다 */
  private save(path: string): Promise<boolean> {
    const running = this.inflight.get(path);
    if (running) return running.promise.then(() => this.save(path));
    const entry = this.pending.get(path);
    if (entry === undefined) return Promise.resolve(true);
    this.pending.delete(path);
    clearTimeout(this.timers.get(path));
    this.timers.delete(path);
    const flight = { ...entry } as Inflight;
    flight.promise = this.write(path, entry, flight);
    this.inflight.set(path, flight);
    return flight.promise;
  }

  private async write(path: string, entry: PendingWrite, flight: Inflight): Promise<boolean> {
    if (flight.prepare) {
      try {
        flight.content = await flight.prepare();
      } catch {
        // 다시 읽지 못해도 예약한 내용으로 쓴다. 버리면 그 쓰기에 실린 자정 정리 기록이 사라진다(리뷰 L-N4)
      }
    }
    try {
      for (let merges = 0; ; merges++) {
        if (flight.base === undefined || !this.store.writeIf) {
          await this.store.write(path, flight.content);
          break;
        }
        const result = await this.store.writeIf(path, flight.content, flight.base);
        if (result.ok) break;
        if (merges === MAX_MERGES) throw `파일이 계속 바뀌고 있어요: ${path}`;
        const current = result.current ?? "";
        flight.content = mergeFile(path, flight.base, flight.content, current);
        flight.base = current;
      }
    } catch {
      this.inflight.delete(path);
      this.slow.delete(path);
      this.failed.add(path);
      // 그 사이 새 내용이 들어오지 않았다면 다시 쓰도록 되돌려 둔다. 기준(base)도 함께 지녀야
      // 나중에 쓸 때 그동안 바뀐 파일과 합칠 수 있다. 쓰는 동안 합쳤거나 기준이 바뀌었으면(rebaseAll) 그 짝을 남긴다
      if (!this.pending.has(path)) {
        const { promise: _promise, ...retry } = flight;
        this.pending.set(path, { ...retry, scheduled: entry.scheduled ?? entry.content });
        this.timers.set(
          path,
          setTimeout(() => void this.save(path), RETRY_MS),
        );
      }
      this.emit("error");
      return false;
    }
    // 듣는 쪽이 hasPending으로 "이어진 내 편집이 있나"를 보므로, 알리기 전에 쓰는 중 표시를 내린다
    this.inflight.delete(path);
    this.slow.delete(path);
    this.failed.delete(path);
    const content = flight.content;
    // 이어서 기다리는 저장이 방금 쓴 것과 같은 기준에서 나왔으면 기준을 방금 쓴 내용으로 옮긴다.
    // 합쳐서 썼으면 옮기지 않는다 — 이어진 저장에는 합친 바깥 변경이 없어서, 옮기면 그걸 덮어쓴다
    const next = this.pending.get(path);
    // 기준 없이 쓰는 저장(설정)은 기준을 얻지 않는다. undefined끼리 같다고 보면 조건부 쓰기·합치기로 바뀐다
    if (next && entry.base !== undefined && next.base === entry.base && content === entry.content) next.base = content;
    const scheduled = entry.scheduled ?? entry.content;
    for (const listener of this.writeListeners) {
      // 듣는 쪽의 오류로 이미 끝난 쓰기를 실패로 만들지 않는다(날짜 이동이 flush 뒤 다시 읽기를 건너뛰게 된다)
      try {
        listener(path, content, scheduled);
      } catch (e) {
        console.error(e);
      }
    }
    this.emit(this.idle() ? "saved" : this.busyStatus());
    return true;
  }

  /**
   * 아직 쓸 것이 남았을 때의 상태. 막힌 쓰기 뒤에 줄 선 편집은 그 쓰기가 끝나야 쓰이고, 실패한 파일은 그 파일 쓰기가 성공할 때까지
   * 알리지 않으므로 둘 다 "기다리는 중"으로 가리지 않는다
   */
  private busyStatus(): SaveStatus {
    if (this.slow.size) return "slow";
    return this.failed.size ? "error" : "pending";
  }

  private emit(status: SaveStatus) {
    for (const listener of this.listeners) listener(status);
  }
}
