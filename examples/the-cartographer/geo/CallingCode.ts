/**
 * CallingCode: offline, browser-safe E.164 calling-code → ISO-3166-1 alpha-2 lookup.
 *
 * Strips the number to digits, tries the longest prefix first (3 → 2 → 1 digits),
 * and returns the matched ISO-2 country code or '' when no match is found.
 *
 * No external dependencies. No `node:` imports.
 *
 * @module
 */

// #region calling-code

const CALLING_CODE_TABLE: Record<string, string> = {
  // 3-digit prefixes (must come before 2-digit prefixes sharing the same root)
  '358': 'FI',
  '353': 'IE',
  '351': 'PT',
  '420': 'CZ',
  '972': 'IL',
  '971': 'AE',
  '966': 'SA',
  '212': 'MA',
  '234': 'NG',
  '254': 'KE',
  // 2-digit prefixes
  '44': 'GB',
  '49': 'DE',
  '33': 'FR',
  '81': 'JP',
  '55': 'BR',
  '86': 'CN',
  '91': 'IN',
  '39': 'IT',
  '34': 'ES',
  '31': 'NL',
  '46': 'SE',
  '47': 'NO',
  '45': 'DK',
  '41': 'CH',
  '43': 'AT',
  '32': 'BE',
  '48': 'PL',
  '61': 'AU',
  '64': 'NZ',
  '27': 'ZA',
  '52': 'MX',
  '54': 'AR',
  '56': 'CL',
  '57': 'CO',
  '82': 'KR',
  '65': 'SG',
  '60': 'MY',
  '66': 'TH',
  '62': 'ID',
  '63': 'PH',
  '84': 'VN',
  '90': 'TR',
  '20': 'EG',
  // 1-digit prefixes
  '1':  'US',
  '7':  'RU',
};

export class CallingCode {
  private constructor() { /* static-only */ }

  /**
   * Return the ISO-3166-1 alpha-2 country code for a phone number's E.164 calling
   * code prefix, or '' when the prefix is unknown or the input is not a phone number.
   *
   * Algorithm:
   *   1. Strip all non-digit characters.
   *   2. Strip leading zeros.
   *   3. Try longest prefix first (3 digits, then 2, then 1).
   *   4. Return the matched ISO-2 or ''.
   */
  static countryFor(phone: string): string {
    const digits = phone.replace(/\D/g, '').replace(/^0+/, '');
    if (digits.length === 0) return '';
    for (const len of [3, 2, 1] as const) {
      if (digits.length >= len) {
        const prefix = digits.slice(0, len);
        const match = CALLING_CODE_TABLE[prefix];
        if (match !== undefined) return match;
      }
    }
    return '';
  }
}

// #endregion calling-code
