/**
 * MobileDetection — triangulated mobile-device check.
 *
 * No single signal is reliable (iPadOS lies in UA, some Android tablets
 * have fine pointers). Triangulate three: touch points, coarse pointer
 * media query, viewport width. All three must indicate mobile to count.
 *
 * The visitor can override via the BackendPicker's "Treat as desktop"
 * toggle (stored in localStorage) — UA detection is a starting hint,
 * not a verdict.
 */

const g = globalThis as {
  window?: { matchMedia?: (q: string) => { matches: boolean }; innerWidth?: number };
  navigator?: { maxTouchPoints?: number };
  localStorage?: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void };
};

export class MobileDetection {
  private constructor() { /* static class */ }

  /** True when the runtime is most likely a phone or small touch device. */
  static isLikelyMobile(): boolean {
    if (g.window === undefined) return false;
    const override = MobileDetection.readOverride();
    if (override !== null) return override === 'mobile';
    const touchPoints = (g.navigator?.maxTouchPoints ?? 0) > 1;
    const coarsePointer = g.window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const narrow = (g.window.innerWidth ?? 1920) < 900;
    return touchPoints && coarsePointer && narrow;
  }

  /** Manual override stored in localStorage. */
  static setOverride(mode: 'mobile' | 'desktop' | null): void {
    if (g.localStorage === undefined) return;
    if (mode === null) g.localStorage.removeItem('dagonizer-device-override');
    else g.localStorage.setItem('dagonizer-device-override', mode);
  }

  static readOverride(): 'mobile' | 'desktop' | null {
    if (g.localStorage === undefined) return null;
    const raw = g.localStorage.getItem('dagonizer-device-override');
    return raw === 'mobile' || raw === 'desktop' ? raw : null;
  }
}
