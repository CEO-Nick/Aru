import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export type LicenseStatus =
  | { state: "disabled" }
  | { state: "licensed"; name: string }
  | { state: "grandfathered" }
  | { state: "trial"; daysLeft: number }
  | { state: "expired" };

export const BUY_URL = "https://aruu.dev/aru/buy/";

export const licenseStatus = () => invoke<LicenseStatus>("license_status");
export const activateLicense = (key: string) => invoke<LicenseStatus>("activate_license", { key });
export const openBuyPage = () => openUrl(BUY_URL);
