import { ref, watch } from "vue";
import type { AutoSaver } from "../core/autoSaver";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "../core/settings";
import type { FileStore } from "../platform/fileStore";

const SETTINGS_PATH = "settings.json";

const serialize = (s: Settings) => JSON.stringify(s, null, 2) + "\n";

export function useSettings(store: FileStore, saver: AutoSaver) {
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
  // 읽어 온 값과 같으면 쓰지 않는다. 앱을 켜기만 해도 파일을 다시 쓰는 일을 막는다
  let baseline: string | null = null;

  async function load() {
    settings.value = parseSettings(await store.read(SETTINGS_PATH));
    baseline = serialize(settings.value);
  }

  watch(
    settings,
    (value) => {
      if (baseline === null) return;
      const content = serialize(value);
      if (content === baseline) return;
      const before = JSON.parse(baseline) as Settings;
      baseline = content;
      // 슬라이더·손잡이처럼 끌면서 계속 바뀌는 값만 기다렸다 쓴다
      const dragging = (Object.keys(value) as (keyof Settings)[]).every(
        (key) => key === "opacity" || key === "splitRatio" || value[key] === before[key],
      );
      saver.schedule(SETTINGS_PATH, content, dragging ? "debounce" : "now");
    },
    { deep: true },
  );

  return { settings, load };
}
