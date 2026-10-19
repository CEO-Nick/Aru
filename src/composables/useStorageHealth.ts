import { nextTick, ref } from "vue";
import type { AutoSaver } from "../core/autoSaver";
import { dataRootStatus, pickDataRoot, resetDataRoot, type RootChanged } from "../platform/dataRoot";
import type { FileStore } from "../platform/fileStore";

// Rust가 고른 저장 폴더를 열 수 없을 때 read_text·write_text를 이 말로 시작하는 오류로 거절한다
export const ROOT_UNAVAILABLE = "저장 폴더를 열 수 없어요";
export const isRootUnavailable = (e: unknown) => String(e).startsWith(ROOT_UNAVAILABLE);
// Rust storage::UNDECODABLE와 같은 글자여야 한다
const UNDECODABLE = "글자로 풀 수 없는 파일이에요";
/** 파일 내용을 글자로 풀 수 없다(UTF-8이 아님). 사용자가 다른 편집기로 고쳐야 하는 파일이다. 그 밖의 읽기 오류(EIO 등)는 잠깐의 문제로 보고 다시 시도한다 */
export const isUndecodable = (e: unknown) => String(e).includes(UNDECODABLE);

const NOTICE_MS = 8000;

export const FOLDER_KEPT = "이미 할 일이 있는 폴더라 지금 할 일은 옮기지 않았어요. 이전 폴더의 할 일은 그대로 있어요";
export const RESTORED_DRAFT = "옛 폴더 목록에 넣지 못한 글을 입력칸에 남겨 두었어요";
export const SOURCE_UNAVAILABLE = "이전 폴더를 열 수 없어 할 일을 옮기지 못했어요. 이전 폴더가 다시 열리면 그 할 일은 그대로 있어요";
const NOT_COPIED: Record<string, string> = { kept: FOLDER_KEPT, sourceUnavailable: SOURCE_UNAVAILABLE };
const FOLDER_KEPT_MS = 10_000;
// 폴더가 바뀌면 창이 새로고침되므로, 알릴 말(옮기지 않은 이유)을 새로고침 너머로 넘긴다
const FOLDER_KEPT_KEY = "aru.folderKept";
const FOLDER_RELOAD_KEY = "aru.folderReload";

/**
 * 파일을 읽고 쓰다 생긴 문제를 한곳에서 다룬다.
 * - 저장 폴더를 열 수 없으면(외장 디스크·iCloud) 아무것도 쓰지 않는다. 빈 폴더에 쓰면 나중에 붙은 진짜 파일을 덮어쓰게 된다.
 *   고친 내용은 자동저장이 기준(base)과 함께 들고 있다가, 폴더가 돌아오면 지금 파일과 합쳐 쓴다.
 *   여기서 따로 붙잡아 두었다가 나중에 쓰지 않는다 — 실패라고 알린 쓰기가 나중에 몰래 써지면 항목이 둘이 된다.
 * - 글자로 풀 수 없는 파일(UTF-8이 아님)에는 절대 쓰지 않는다. 사용자가 다른 편집기로 고칠 원본이다.
 */
export function useStorageHealth() {
  /** 저장 폴더를 열 수 없는 동안 그 폴더 경로(모르면 ""). 열 수 있으면 null */
  const unavailable = ref<string | null>(null);
  /** 잠깐 보여 줄 실패 알림(폴더 변경 실패, 옮기기 실패) */
  const notice = ref<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  /** 잠깐 보여 줄 안내(폴더를 바꿨지만 할 일을 옮기지 않음). 폴더를 열 수 없다는 경고보다 뒤에 보인다 */
  const info = ref<string | null>(null);

  function markUnavailable(e: unknown) {
    unavailable.value = String(e).slice(ROOT_UNAVAILABLE.length).replace(/^:\s*/, "");
  }

  function notify(message: string, ms = NOTICE_MS) {
    notice.value = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.value = null), ms);
  }

  const kept = takeFolderKept();
  if (kept) {
    info.value = kept;
    setTimeout(() => (info.value = null), FOLDER_KEPT_MS);
  }

  /** 문제를 알아채고 위험한 쓰기를 막는 저장소로 감싼다 */
  function guard(store: FileStore): FileStore {
    /** 글자로 풀 수 없었던 파일 */
    const unreadable = new Set<string>();

    function allow(path: string) {
      if (unreadable.has(path)) throw `읽지 못한 파일이라 쓰지 않았어요: ${path}`;
      if (unavailable.value !== null) throw ROOT_UNAVAILABLE;
    }

    async function noting<T>(write: () => Promise<T>): Promise<T> {
      try {
        return await write();
      } catch (e) {
        if (isRootUnavailable(e)) markUnavailable(e);
        throw e;
      }
    }

    return {
      async read(path) {
        try {
          const content = await store.read(path);
          unreadable.delete(path);
          return content;
        } catch (e) {
          if (isRootUnavailable(e)) markUnavailable(e);
          else if (isUndecodable(e)) unreadable.add(path);
          throw e;
        }
      },
      async write(path, content) {
        allow(path);
        await noting(() => store.write(path, content));
      },
      ...(store.writeIf && {
        async writeIf(path: string, content: string, expected: string | null) {
          allow(path);
          return noting(() => store.writeIf!(path, content, expected));
        },
      }),
      ...(store.list && { list: (dir: string) => noting(() => store.list!(dir)) }),
    };
  }

  let inflight: Promise<boolean> | null = null;

  /**
   * 폴더를 다시 열 수 있게 됐는지 본다. 돌아왔으면 recover로 밀린 변경을 지금 파일과 합친 뒤에야 쓰기를 연다.
   * 쓰기를 먼저 열면 밀린 저장이 그 사이 다른 기기가 고친 파일을 덮어쓴다. 돌아왔으면 true.
   * 이미 확인 중이면 그 결과를 함께 기다린다 — 바로 false를 돌려주면 폴더 변경 직후 창을 새로 열며 밀린 내용을 잃는다
   */
  function check(recover: () => Promise<void>): Promise<boolean> {
    if (inflight) return inflight;
    if (unavailable.value === null) return Promise.resolve(false);
    inflight = (async () => {
      try {
        const status = await dataRootStatus();
        if (status && !status.ok) {
          unavailable.value = status.path;
          return false;
        }
        await recover();
        unavailable.value = null;
        return true;
      } catch (e) {
        if (isRootUnavailable(e)) markUnavailable(e);
        return false;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  const folderFailed = (e: unknown) => notify(`폴더를 바꾸지 못했어요: ${e instanceof Error ? e.message : String(e)}`);

  /** 다른 폴더를 고른다. 바뀌면 data-root-changed가 온다 */
  async function repick(beforeChange: () => Promise<unknown> = async () => {}) {
    try {
      await beforeChange();
      await pickDataRoot();
    } catch (e) {
      folderFailed(e);
    }
  }

  async function useDefault() {
    try {
      await resetDataRoot();
    } catch (e) {
      folderFailed(e);
    }
  }

  return { unavailable, notice, info, notify, guard, check, repick, useDefault };
}

/**
 * 저장 폴더가 바뀌었을 때(data-root-changed). 아직 쓰지 못한 내용을 새 폴더 파일과 합쳐 쓴 뒤에만 창을 새로 연다.
 * 할 일을 새 폴더로 복사했으면(copied) 새 폴더 파일이 옛 기준과 같으므로 기준을 그대로 두고 3-way로 합친다 —
 * 합집합으로 합치면 방금 지운 할 일이 되살아나고 체크한 할 일이 둘이 된다.
 * 복사하지 않았으면(또는 기본 폴더로 되돌려 알 수 없으면) 옛 폴더에서 읽은 내용은 새 폴더 파일의 기준이 아니므로
 * 기준을 ""로 바꿔 합집합으로 합친다 — 옛 기준으로 3-way로 합치면 새 폴더의 최신 할 일이 "지운 줄"로 보인다
 */
export async function switchFolder(
  health: ReturnType<typeof useStorageHealth>,
  saver: AutoSaver,
  files: { forgetBase: () => void }[],
  checkStorage: () => Promise<void>,
  reloadSettings: () => Promise<void>,
  changed: RootChanged | null = null,
  commitDrafts: () => void = () => {},
) {
  // 새로고침하면 입력칸에 쓰다 만 글이 사라진다. 할 일로 넣어 아래 기준 바꾸기·저장에 함께 태운다(목록 저장 예약은 다음 틱에 걸린다)
  commitDrafts();
  await nextTick();
  if (changed?.copied !== true) {
    for (const file of files) file.forgetBase();
    saver.rebaseAll("");
    // 옮기지 않은 폴더(되돌린 기본 폴더 포함)에는 그 폴더의 설정이 있을 수 있다. 이 창의 설정을 통째로 쓰면 덮어쓰므로
    // 버리고 새 폴더 것을 곧바로 읽는다(아직 쓰지 못하고 바꾼 값만 그 위에 얹는다) — 새로고침하지 못하고 창이 남으면
    // 옛 설정을 들고 있다가 다음에 하나만 바꿔도 통째로 쓴다
    saver.discard("settings.json");
    await reloadSettings();
  }
  await checkStorage();
  await saver.flush();
  if (saver.idle()) {
    if (changed && !changed.copied && NOT_COPIED[changed.reason]) keep(FOLDER_KEPT_KEY, changed.reason);
    keep(FOLDER_RELOAD_KEY, "1");
    location.reload();
  } else health.notify("새 폴더에 아직 저장하지 못했어요. 고친 내용은 창에 남아 있어요");
}

// sessionStorage를 못 쓰는 환경이면 안내만 빠진다
function keep(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {}
}

/** 폴더를 바꿔 새로고침된 창인가. 한 번 꺼내면 지운다 */
export function reloadedForFolder(): boolean {
  try {
    const marked = sessionStorage.getItem(FOLDER_RELOAD_KEY) !== null;
    sessionStorage.removeItem(FOLDER_RELOAD_KEY);
    return marked;
  } catch {
    return false;
  }
}

/** 새로고침 전에 남긴 "옮기지 않은 이유"의 안내 문구. 한 번 꺼내면 지운다 */
function takeFolderKept(): string | null {
  try {
    const reason = sessionStorage.getItem(FOLDER_KEPT_KEY);
    sessionStorage.removeItem(FOLDER_KEPT_KEY);
    return reason === null ? null : (NOT_COPIED[reason] ?? null);
  } catch {
    return null;
  }
}
