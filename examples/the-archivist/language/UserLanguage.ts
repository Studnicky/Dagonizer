/**
 * UserLanguage: domain helper for resolving the visitor's device
 * language and converting it across the code formats different APIs
 * expect.
 *
 *   detect()                runtime probe: navigator.language (browser),
 *                             process.env.LANG (Node CLI), else 'en'.
 *   normalize(input)        coerce any locale string to lower-case ISO 639-1
 *                             code (e.g. 'en-US' → 'en', 'ja_JP.UTF-8' → 'ja').
 *   toIso6392(code)         ISO 639-1 → ISO 639-2 (e.g. 'en' → 'eng',
 *                             'ja' → 'jpn'). Used by OpenLibrary `lang`.
 *   displayName(code)       human-readable name in the user's locale
 *                             (e.g. 'en' → 'English'). Used in prompts.
 *
 * Static-only. No instances. All conversions are pure functions over the
 * supplied input; no global state, no module-level mutation past the
 * frozen `ISO_639_1_TO_2` map.
 */

const ISO_639_1_TO_2: Readonly<Record<string, string>> = Object.freeze({
  'en': 'eng', 'es': 'spa', 'fr': 'fre', 'de': 'ger', 'it': 'ita',
  'pt': 'por', 'nl': 'dut', 'sv': 'swe', 'no': 'nor', 'da': 'dan',
  'fi': 'fin', 'pl': 'pol', 'cs': 'cze', 'ru': 'rus', 'uk': 'ukr',
  'ja': 'jpn', 'zh': 'chi', 'ko': 'kor', 'ar': 'ara', 'he': 'heb',
  'hi': 'hin', 'tr': 'tur', 'el': 'gre', 'th': 'tha', 'vi': 'vie',
});

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
   * Convert an ISO 639-1 (alpha-2) code to its ISO 639-2 (alpha-3)
   * counterpart. Used by OpenLibrary's `lang` parameter. Returns
   * `'eng'` for any unknown code so upstream APIs always receive a
   * recognised value rather than an empty string.
   */
  static toIso6392(code: string): string {
    const normalized = UserLanguage.normalize(code);
    const mapped = ISO_639_1_TO_2[normalized];
    return mapped !== undefined ? mapped : 'eng';
  }

  /**
   * Human-readable language name in the user's own locale. Used to
   * inject a clear directive into prompts ("Respond in English (en)").
   * Falls back to the raw code when `Intl.DisplayNames` is unavailable
   * or throws (older runtimes, malformed code).
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
