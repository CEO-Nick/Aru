export interface WindowControl {
  setOpacity(alpha: number): Promise<void>;
  setAlwaysOnTop(on: boolean): Promise<void>;
}
