/**
 * Error thrown when the geohash timezone map artifact is corrupt or missing.
 *
 * @module
 */

/**
 * Thrown when the geohash4 binary artifact fails header validation or when
 * the locale-extended tuples table is malformed.
 */
export class GeohashTzMapError extends Error {
  public constructor(detail: string) {
    super(`GeohashTzMap: artifact error — ${detail}`);
    this.name = 'GeohashTzMapError';
  }
}
