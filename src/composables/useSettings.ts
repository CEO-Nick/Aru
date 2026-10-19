import { ref, watch } from "vue";
import type { AutoSaver } from "../core/autoSaver";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "../core/settings";
import type { FileStore } from "../platform/fileStore";
import { isRootUnavailable } from "./useStorageHealth";

const SETTINGS_PATH = "settings.json";

const serialize = (s: Partial<Settings>) => JSON.stringify(s, null, 2) + "\n";
/** lastRolloverDate·rolloverPending는 사용자가 바꾸는 값이 아니라 그 폴더의 할 일을 어디까지 정리했는지다 */
const withoutRollover = ({ lastRolloverDate: _l, rolloverPending: _p, ...rest }: Settings) => rest;

export function useSettings(store: FileStore, saver: AutoSaver) {
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
  /** 설정 파일을 읽지 못한 이유. 그동안은 기본값으로 보이기만 하고 파일에 쓰지 않는다 */
  const error = ref<string | null>(null);
  /** 파일을 읽었다. 읽기 전의 기본값(lastRolloverDate 등)을 믿고 무언가를 하면 안 된다 */
  const ready = ref(false);
  // 읽어 온 값과 같으면 쓰지 않는다. 앱을 켜기만 해도 파일을 다시 쓰는 일을 막는다
  let baseline: string | null = null;
  /**
   * 파일에 들어 있다고 아는 설정(읽었거나 다 쓴 것). 처음부터 못 읽었으면 그때 화면 값.
   * 다시 읽을 때 이것과 다른 값만 이 창에서 바꾸고 아직 쓰지 못한 것으로 보고 파일 값 위에 얹는다 —
   * 폴더가 돌아왔거나 다른 폴더로 바뀐 경우, 통째로 쓰면 그 파일의 다른 값을 덮고 통째로 읽으면 바꾼 값을 잃는다
   */
  let known: Settings | null = null;

  /** 마지막으로 읽었거나 쓴 파일 원문. refresh가 그대로면 아무것도 하지 않게 */
  let lastRaw: string | null | undefined;

  saver.onWrite((path, written) => {
    if (path !== SETTINGS_PATH) return;
    known = parseSettings(written);
    lastRaw = written;
  });

  /**
   * 파일이 없어 읽은 기본값을 아직 쓰지 않았다. 폴더가 늦게 붙어(iCloud) 진짜 설정이 아직 안 내려온 것일 수 있으므로
   * 자정 정리 기록만 바뀐 것으로는 쓰지 않고, 사용자가 무언가 바꿀 때 처음 쓴다
   */
  let absent = false;

  /**
   * 읽는다(폴더가 바뀌었으면 새 폴더 것). 저장 폴더를 열 수 없으면 던진다.
   * adopt: 사용자가 폴더를 바꾼 때. 설정 파일이 없는 폴더(할 일만 있는 폴더)면 이 창의 설정을 그 폴더에 쓴다 —
   * 기본값으로 읽으면 사용자가 끈 AI 추가가 말없이 다시 켜진다. 그 밖(켤 때·폴더가 돌아올 때)에는 쓰지 않는다
   * sameFolder: 같은 폴더의 파일을 다시 읽는다(refresh). 원문이 그대로면 아무것도 하지 않고, 이 창이 아직 쓰지 못한
   *   정리 기록도 얹는다 — 같은 폴더의 기록이라 버리면 정리한 날을 다시 정리한다
   */
  async function read({ adopt: adopting = false, sameFolder = false, beforeWrite = false } = {}) {
    let raw: string | null;
    try {
      raw = await store.read(SETTINGS_PATH);
    } catch (e) {
      // 쓰기 직전 읽기가 잠깐 실패한 것으로 설정 오류 상태가 되면 그 쓰기가 버려진다. 3초 확인이 다시 판단한다(리뷰 L-N4)
      if (beforeWrite) throw e;
      baseline = null;
      ready.value = false;
      // 못 읽는 동안 바꾼 값은 다시 읽을 때 얹는다. 지금 화면 값을 파일에 있다고 아는 값으로 둔다
      known ??= { ...settings.value };
      if (isRootUnavailable(e)) throw e;
      error.value = String(e);
      return;
    }
    if (sameFolder && raw === lastRaw) return;
    // 한 번 읽은 파일이 없어진 것은 iCloud가 내려 둔 것이거나 다른 맥이 다시 쓰는 중일 수 있다. 기본값으로 내려가면
    // 다음 변경 때 진짜 설정을 기본값으로 덮으므로 다음 확인을 기다린다(리뷰 M-N1). 일부러 지운 초기화는 다음 실행에 반영된다
    if (sameFolder && raw === null && lastRaw != null) return;
    lastRaw = raw;
    // 정리 기록(lastRolloverDate·rolloverPending)은 그 폴더 것이라 가져가지 않는다
    const adopt = adopting && raw === null && known !== null;
    const file = adopt ? { ...withoutRollover(settings.value), lastRolloverDate: null } : parseSettings(raw);
    const start = known;
    // lastRolloverDate는 사용자가 바꾸는 값이 아니라 그 폴더의 할 일을 어디까지 정리했는지다. 얹으면 새 폴더의 밀린 날을 정리한 것으로 본다
    const keys = sameFolder ? new Set([...Object.keys(file), ...Object.keys(settings.value)]) : Object.keys(withoutRollover(file));
    const changed = start
      ? ([...keys] as (keyof Settings)[]).filter((key) => JSON.stringify(settings.value[key]) !== JSON.stringify(start[key]))
      : [];
    known = file;
    baseline = serialize(file);
    const next = { ...file, ...Object.fromEntries(changed.map((key) => [key, settings.value[key]])) };
    for (const key of changed) if (settings.value[key] === undefined) delete next[key];
    settings.value = next;
    error.value = null;
    ready.value = true;
    absent = raw === null && !adopt;
    if (adopt) saver.schedule(SETTINGS_PATH, baseline, "now");
  }

  const load = (options?: { adopt?: boolean }) => read(options).catch(() => {});

  /** 저장 폴더가 돌아왔거나 못 읽던 파일이 읽히게 됐을 때 다시 읽는다. 폴더를 아직 열 수 없으면 던진다 */
  async function recover() {
    if (!ready.value) await read();
  }

  /** 다른 창·다른 맥이 바꿨을 수 있는 파일을 다시 읽는다(파일 변경 알림·3초 확인). 못 읽으면 조용히 다음에 */
  async function refresh() {
    if (ready.value) await read({ sameFolder: true }).catch(() => {});
  }

  /** 쓰기 직전에 다시 읽는 중. 그동안 바뀐 값은 다시 읽은 뒤 만드는 내용에 함께 들어간다 */
  let rechecking = false;

  /**
   * 다른 맥이 바꾼 파일을 3초 확인보다 먼저 쓰거나(QA12 B2), 켤 때 없던 파일이 그새 내려왔을 수 있다(iCloud, 리뷰 M1).
   * 통째로 쓰면 그 값을 덮으므로 실제로 쓰는 순간 다시 읽어 그 위에 바꾼 값만 얹는다
   */
  async function beforeWrite() {
    rechecking = true;
    try {
      if (ready.value) await read({ sameFolder: true, beforeWrite: true });
    } catch {
      // 못 읽었으면 지금 값으로 쓴다
    } finally {
      rechecking = false;
    }
    const content = serialize(settings.value);
    // 그새 다른 읽기가 실패해(baseline null) 쓰지 않는 상태로 들어갔으면 그대로 둔다
    if (baseline !== null) baseline = content;
    return content;
  }

  watch(
    settings,
    (value) => {
      if (baseline === null) return;
      const content = serialize(value);
      if (content === baseline) return;
      const before = JSON.parse(baseline) as Settings;
      baseline = content;
      if (rechecking) return;
      if (absent) {
        if (serialize(withoutRollover(value)) === serialize(withoutRollover(before))) return;
        absent = false;
      }
      // 슬라이더·손잡이처럼 끌면서 계속 바뀌는 값만 기다렸다 쓴다
      // 지운 키(rolloverPending)도 바뀐 것으로 본다. value 쪽 키만 보면 정리 기록을 지운 쓰기가 끄는 중으로 늦춰진다
      const dragging = ([...new Set([...Object.keys(value), ...Object.keys(before)])] as (keyof Settings)[]).every(
        (key) => key === "opacity" || key === "splitRatio" || value[key] === before[key],
      );
      saver.schedule(SETTINGS_PATH, content, dragging ? "debounce" : "now", undefined, beforeWrite);
    },
    { deep: true },
  );

  return { settings, load, recover, refresh, error, ready };
}
