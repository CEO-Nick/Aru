export type CarryOver = "keep" | "next-day" | "someday";

export interface Settings {
  /** 투명도 슬라이더 값 0~100 */
  opacity: number;
  /** 위쪽(오늘) 영역 높이 비율 */
  splitRatio: number;
  alwaysOnTop: boolean;
  carryOver: CarryOver;
  /** 자정 전환을 마지막으로 처리한 날짜. 며칠 꺼져 있던 경우를 따라잡는 데 쓴다 */
  lastRolloverDate: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  opacity: 100,
  splitRatio: 0.6,
  alwaysOnTop: true,
  carryOver: "keep",
  lastRolloverDate: null,
};

const CARRY_OVERS: CarryOver[] = ["keep", "next-day", "someday"];

export function parseSettings(json: string | null): Settings {
  let raw: Partial<Settings> = {};
  try {
    raw = json ? JSON.parse(json) : {};
  } catch {
    raw = {};
  }
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  if (!CARRY_OVERS.includes(merged.carryOver)) merged.carryOver = DEFAULT_SETTINGS.carryOver;
  return merged;
}
