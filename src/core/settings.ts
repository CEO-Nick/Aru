export type CarryOver = "keep" | "next-day" | "someday";

export interface Settings {
  /** 투명도 슬라이더 값 0~100 */
  opacity: number;
  /** 위쪽(오늘) 영역 높이 비율 */
  splitRatio: number;
  alwaysOnTop: boolean;
  /** 체크하면 끝낸 일들 위로 옮긴다 */
  sortChecked: boolean;
  /** AI 도구·aru 명령이 할 일을 넣도록 허용한다 */
  allowExternalAdd: boolean;
  carryOver: CarryOver;
  /** 자정 전환을 마지막으로 처리한 날짜. 며칠 꺼져 있던 경우를 따라잡는 데 쓴다 */
  lastRolloverDate: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  opacity: 100,
  splitRatio: 0.6,
  alwaysOnTop: true,
  sortChecked: true,
  allowExternalAdd: true,
  carryOver: "keep",
  lastRolloverDate: null,
};

const CARRY_OVERS: CarryOver[] = ["keep", "next-day", "someday"];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 사람이 손으로 고치거나 다른 버전이 쓴 설정 파일도 있으므로 값마다 형식을 확인한다 */
export function parseSettings(json: string | null): Settings {
  let raw: unknown = null;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SETTINGS };
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    opacity: isNumber(r.opacity) ? clamp(r.opacity, 0, 100) : d.opacity,
    splitRatio: isNumber(r.splitRatio) ? clamp(r.splitRatio, 0.2, 0.8) : d.splitRatio,
    alwaysOnTop: typeof r.alwaysOnTop === "boolean" ? r.alwaysOnTop : d.alwaysOnTop,
    sortChecked: typeof r.sortChecked === "boolean" ? r.sortChecked : d.sortChecked,
    allowExternalAdd: typeof r.allowExternalAdd === "boolean" ? r.allowExternalAdd : d.allowExternalAdd,
    carryOver: CARRY_OVERS.includes(r.carryOver as CarryOver) ? (r.carryOver as CarryOver) : d.carryOver,
    lastRolloverDate:
      typeof r.lastRolloverDate === "string" && ISO_DATE.test(r.lastRolloverDate) ? r.lastRolloverDate : null,
  };
}
