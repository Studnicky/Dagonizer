/**
 * UserLanguage: domain helper for resolving the visitor's device language
 * so composed replies come back in the language they wrote in.
 *
 *   detect()          runtime probe: navigator.language (browser),
 *                       process.env.LANG (Node CLI), else 'en'.
 *   normalize(input)  coerce any locale string to lower-case ISO 639-1
 *                       code (e.g. 'en-US' → 'en', 'ja_JP.UTF-8' → 'ja').
 *   displayName(code)  human-readable name in the resolved locale
 *                       (e.g. 'en' → 'English'). Used in the compose prompt.
 *
 * Static-only. No instances. All conversions are pure functions over the
 * supplied input; no global state.
 */

export class UserLanguage {
  private constructor() { /* static */ }

  /**
   * Runtime probe for the visitor's device language. Tries
   * `navigator.language` (browser) first, then `process.env.LANG`
   * (Node CLI), then falls back to `'en'`. The returned code is
   * always a lower-case ISO 639-1 alpha-2 string.
   */
  static detect(): string {
    if (typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language.length > 0) {
      return UserLanguage.normalize(navigator.language);
    }
    if (typeof process !== 'undefined' && process.env !== undefined) {
      const lang = process.env['LANG'];
      if (typeof lang === 'string' && lang.length > 0) {
        return UserLanguage.normalize(lang);
      }
    }
    return 'en';
  }

  /**
   * Coerce any locale string to a lower-case ISO 639-1 code by
   * stripping the region / encoding / modifier subtags.
   *   'en-US'         → 'en'
   *   'ja_JP.UTF-8'   → 'ja'
   *   'pt_BR@variant' → 'pt'
   *   ''              → 'en'
   */
  static normalize(input: string): string {
    if (typeof input !== 'string' || input.length === 0) return 'en';
    const head = input.toLowerCase().split(/[-_.@]/u)[0];
    return head !== undefined && head.length > 0 ? head : 'en';
  }

  /**
   * Human-readable language name in the resolved locale. Used to inject a
   * clear directive into the compose/classify prompts ("Respond in
   * English (en)"). Falls back to the raw code when `Intl.DisplayNames`
   * is unavailable or throws (older runtimes, malformed code).
   */
  static displayName(code: string): string {
    const normalized = UserLanguage.normalize(code);
    try {
      const dn = new Intl.DisplayNames([normalized], { 'type': 'language' });
      const resolved = dn.of(normalized);
      return typeof resolved === 'string' && resolved.length > 0 ? resolved : normalized;
    } catch {
      return normalized;
    }
  }
}
