import { isBlankTodoText } from "./text";

/**
 * 입력칸에 쓰다 만 글을 이 맥(webview localStorage)에 따로 남긴다. 목록이 막혀 넣지 못한 채 종료하거나
 * 창이 새로 열려도(폴더 변경) 다시 열 때 되돌린다.
 * - 거울(창.목록): 그 창만 쓰고 지운다. 창이 제 상태를 비추는 자리라 언제든 통째로 덮인다.
 * - 넘길 글(orphan.창.목록): 거울 주인이 사라져(앱을 다시 켬) 남은 글. 작은 창만 꺼내 할 일로 넣는다 —
 *   거울에 되돌려 두면 그 창이 다시 뜨는 순간 제 빈 상태로 덮어 지운다(리뷰 H1)
 * 할 일 글에는 줄바꿈이 없으므로, 한 자리에 글이 여럿이면 줄로 잇는다
 */
const PREFIX = "aru.draft.";
const ORPHAN = "orphan.";

export function keepDraft(slot: string, text: string) {
  try {
    if (isBlankTodoText(text)) localStorage.removeItem(PREFIX + slot);
    else localStorage.setItem(PREFIX + slot, text);
  } catch {}
}

export function keptDraft(slot: string): string {
  try {
    return localStorage.getItem(PREFIX + slot) ?? "";
  } catch {
    return "";
  }
}

const lines = (text: string) => text.split("\n").filter((t) => !isBlankTodoText(t));

/** 넘길 글에 더한다. 이미 있는 글은 더하지 않는다(두 창이 같은 거울을 동시에 옮겨도 하나) */
export function orphan(slot: string, texts: string[]) {
  const kept = lines(keptDraft(ORPHAN + slot));
  keepDraft(ORPHAN + slot, [...kept, ...texts.filter((t) => !isBlankTodoText(t) && !kept.includes(t))].join("\n"));
}

/** 그 창의 거울에 남은 글(지난 실행의 것)을 넘길 글로 옮긴다. 창이 제 거울을 쓰기 시작하기 전에 부른다 */
export function orphanDrafts(window: string) {
  try {
    for (const key of Object.keys(localStorage).filter((k) => k.startsWith(`${PREFIX}${window}.`))) {
      const slot = key.slice(PREFIX.length);
      orphan(slot, lines(keptDraft(slot)));
      localStorage.removeItem(key);
    }
  } catch {}
}

/** 넘길 글을 자리별로 본다(slot은 orphan. 을 뗀 원래 자리). 넣은 자리는 dropOrphan으로 지운다 */
export function orphans(): { slot: string; texts: string[] }[] {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX + ORPHAN))
      .sort()
      .map((key) => ({ slot: key.slice(PREFIX.length + ORPHAN.length), texts: lines(localStorage.getItem(key) ?? "") }));
  } catch {
    return [];
  }
}

export const dropOrphan = (slot: string) => keepDraft(ORPHAN + slot, "");
