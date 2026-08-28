/**
 * Unit tests for locale-derived timezone resolution.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LocaleTimezone } from '@studnicky/geo-resolver';

// ---------------------------------------------------------------------------
// LocaleTimezone
// ---------------------------------------------------------------------------

describe('LocaleTimezone', () => {
  it('toIana("en-US") startsWith "America/"', () => {
    const tz = LocaleTimezone.toIana('en-US');
    assert.ok(tz.startsWith('America/'), `expected America/…, got: ${JSON.stringify(tz)}`);
  });

  it('toIana("ja-JP") === "Asia/Tokyo"', () => {
    assert.equal(LocaleTimezone.toIana('ja-JP'), 'Asia/Tokyo');
  });

  it('toIana("en") === "" (no region subtag)', () => {
    assert.equal(LocaleTimezone.toIana('en'), '');
  });
});
