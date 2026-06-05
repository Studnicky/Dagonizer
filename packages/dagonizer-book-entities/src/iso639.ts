/**
 * ISO 639-1 → ISO 639-2 (alpha-3) mapping shared across book-domain tools.
 *
 * Google Books reports ISO 639-1 codes (e.g. 'en'). Wikipedia uses the same
 * codes for its subdomain routing. OpenLibrary already returns 639-2. This
 * module normalises all three to the same code shape so `book.languages[]`
 * is consistent across scouts and the downstream language filter can do a
 * simple string-equality check.
 *
 * Unknown codes pass through unchanged so the consumer can still match
 * exact-string when the mapping is incomplete.
 */

export const ISO_639_1_TO_2: Readonly<Record<string, string>> = Object.freeze({
  'en': 'eng', 'es': 'spa', 'fr': 'fre', 'de': 'ger', 'it': 'ita',
  'pt': 'por', 'nl': 'dut', 'sv': 'swe', 'no': 'nor', 'da': 'dan',
  'fi': 'fin', 'pl': 'pol', 'cs': 'cze', 'ru': 'rus', 'uk': 'ukr',
  'ja': 'jpn', 'zh': 'chi', 'ko': 'kor', 'ar': 'ara', 'he': 'heb',
  'hi': 'hin', 'tr': 'tur', 'el': 'gre', 'th': 'tha', 'vi': 'vie',
});

export class LanguageCode {
  private constructor() { /* static class */ }

  /**
   * Map an ISO 639-1 code (or BCP-47 tag) to its ISO 639-2 alpha-3 equivalent.
   * The input is lowercased and the subtag (after `-` or `_`) is stripped before
   * lookup, so `en-US`, `en_GB`, and `en` all map to `eng`.
   *
   * When the code is not in the table the normalised head segment is returned as-is
   * so three-letter 639-2 codes (e.g. `jpn`) pass through unchanged.
   */
  static toIso6392(code: string): string {
    const head = code.toLowerCase().split(/[-_]/u)[0];
    if (head === undefined || head.length === 0) return code;
    const mapped = ISO_639_1_TO_2[head];
    return mapped !== undefined ? mapped : head;
  }
}
