/**
 * coerce-types: shared ingest transform — string cells → number / bool / epoch.
 *
 * CSV and NDJSON sources carry every value as a string; JSON sources carry
 * native types. This node coerces each canonical field to the type the
 * CanonicalEvent body expects:
 *   - numeric fields (lat/lng, weight, sensor channels) → number
 *   - boolean fields (marketingConsent, delivered)      → boolean
 *   - timestamp fields (epochRaw)                        → epoch ms (number)
 *   - lineItems                                          → parsed array
 * It coerces IN PLACE on state.mappedRecords so validate-event can assemble the
 * typed CanonicalEvent. The raw timestamp string is preserved under `epochRaw`
 * for downstream normalization; the parsed epoch is written to `epochMs`.
 *
 * Routes 'validate-event'.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';
import { TimeNormalizer } from '../../services.ts';

import { NodeOutputBuilder, type NodeInterface } from '@noocodex/dagonizer';

// #region coerce-types-node
const NUMERIC_FIELDS = [
  'scanSeq', 'latitude', 'longitude', 'legFromLat', 'legFromLng',
  'originLat', 'originLng', 'destLat', 'destLng', 'weight',
  'tempC', 'humidityPct', 'shockG',
] as const;

const BOOLEAN_FIELDS = ['marketingConsent', 'delivered'] as const;

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return isFinite(n) ? n : 0;
  }
  return 0;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return false;
}

export const coerceTypes: NodeInterface<CartographerState, 'validate-event', CartographerServices> = {
  'name': 'coerce-types',
  'outputs': ['validate-event'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const coerced: Array<Record<string, unknown>> = state.mappedRecords.map((rec) => {
      const out: Record<string, unknown> = { ...rec };
      for (const field of NUMERIC_FIELDS) {
        if (field in out) out[field] = toNumber(out[field]);
      }
      for (const field of BOOLEAN_FIELDS) {
        if (field in out) out[field] = toBoolean(out[field]);
      }
      // Timestamp string → epoch ms (kept alongside the raw string).
      if ('epochRaw' in out) {
        out['epochMs'] = TimeNormalizer.toEpochMs(String(out['epochRaw'] ?? ''));
      }
      // lineItems may arrive as a JSON string (CSV/NDJSON) or an array (JSON).
      if ('lineItems' in out && typeof out['lineItems'] === 'string') {
        try {
          out['lineItems'] = JSON.parse(out['lineItems']);
        } catch {
          out['lineItems'] = [];
        }
      }
      return out;
    });
    state.mappedRecords = coerced;
    return NodeOutputBuilder.of('validate-event');
  },
};
// #endregion coerce-types-node
