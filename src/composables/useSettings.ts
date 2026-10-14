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
      baseline = content;
      saver.schedule(SETTINGS_PATH, content, "debounce");
    },
    { deep: true },
  );

  return { settings, load };
}
