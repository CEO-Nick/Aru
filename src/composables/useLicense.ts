import { computed, ref } from "vue";
import { activateLicense, licenseStatus, type LicenseStatus } from "../platform/license";

// 창 여러 곳(목록, 설정, 창 아래)이 같은 상태를 본다
const status = ref<LicenseStatus>({ state: "disabled" });
let started = false;

async function refresh() {
  status.value = await licenseStatus().catch(() => ({ state: "disabled" }) as LicenseStatus);
}

async function activate(key: string): Promise<string | null> {
  try {
    status.value = await activateLicense(key);
    return null;
  } catch (e) {
    return typeof e === "string" ? e : "라이선스 키가 올바르지 않아요";
  }
}

export function useLicense() {
  if (!started) {
    started = true;
    void refresh();
  }
  return {
    status,
    /** 체험이 끝나 새로 적기를 막아야 하는가 */
    locked: computed(() => status.value.state === "expired"),
    refresh,
    activate,
  };
}
