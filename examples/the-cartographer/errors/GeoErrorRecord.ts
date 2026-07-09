/**
 * GeoErrorRecord: a structured record of one caught exception, carried as
 * FIRST-CLASS DATA through the DAG rather than swallowed in a `catch`.
 *
 * The cartographer's transports (reverse-geocode, ip-geolocate) and ingest
 * parsers used to discard caught exceptions in bare `catch {}` blocks — the
 * failure became invisible. Each swallow site now CAPTURES the error into a
 * `GeoErrorRecordType` instead. The record rides on `state.errors` (an
 * ephemeral, non-serialized accumulator like `ipCandidate`); the gather folds
 * every clone's records into a bounded parent-side rollup so the run can PRINT
 * the error distribution for analysis.
 *
 * Fields:
 *   - source  : which stage / transport caught the error
 *               ('reverse-geocode', 'ip-geolocate', 'parse-json', …).
 *   - variant : the thrown error's class name ('RangeError', 'SyntaxError', …).
 *   - message : the thrown error's message.
 *   - input   : a short summary of the offending input (coords / ip / payload id),
 *               bounded so a hot error source does not retain unbounded strings.
 */

// #region geo-error-record
import type { FromSchema } from 'json-schema-to-ts';
import { Validator } from '@studnicky/dagonizer/validation';

export const GeoErrorRecordSchema = {
  '$id': 'https://noocodec.dev/schemas/cartographer/GeoErrorRecord',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['source', 'variant', 'message', 'input'],
  'properties': {
    'source':  { 'type': 'string' },
    'variant': { 'type': 'string' },
    'message': { 'type': 'string' },
    'input':   { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

export type GeoErrorRecordType = FromSchema<typeof GeoErrorRecordSchema>;
const geoErrorRecordValidator = Validator.compile<GeoErrorRecordType>(GeoErrorRecordSchema);


/** Longest `input` summary retained per record; longer summaries are truncated. */
const MAX_INPUT_SUMMARY = 80;

/** Longest `message` retained per record. */
const MAX_MESSAGE = 200;

export class GeoErrorRecord {
  /**
   * Type-guard for GeoErrorRecordType. Narrows `unknown` to the schema-derived type.
   */
  static is(value: unknown): value is GeoErrorRecordType {
    return geoErrorRecordValidator.is(value);
  }

  /**
   * Type-guard for an array of GeoErrorRecordType.
   */
  static isArray(value: unknown): value is GeoErrorRecordType[] {
    return Array.isArray(value) && value.every((item) => GeoErrorRecord.is(item));
  }

  /**
   * Capture a caught value into a `GeoErrorRecordType`. `error` is the value a
   * `catch` bound (typed `unknown`); a thrown `Error` yields its class name and
   * message, any other thrown value uses `'UnknownError'` and its
   * string form. `input` is a short human summary of the offending input.
   */
  static capture(source: string, error: unknown, input: string): GeoErrorRecordType {
    const errorVariant = error instanceof Error ? error.constructor.name : 'UnknownError';
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error);
    return {
      'source':  source,
      'variant': errorVariant,
      'message': GeoErrorRecord.truncate(message, MAX_MESSAGE),
      'input':   GeoErrorRecord.truncate(input, MAX_INPUT_SUMMARY),
    };
  }

  /** A short human label for a coordinate pair, for the `input` summary. */
  static coords(lat: number, lng: number): string {
    return `lat=${lat.toFixed(4)} lng=${lng.toFixed(4)}`;
  }

  private static truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }
}
// #endregion geo-error-record
