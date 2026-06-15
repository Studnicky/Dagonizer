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

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region coerce-types-node
const NUMERIC_FIELDS = [
  'scanSeq', 'latitude', 'longitude', 'legFromLat', 'legFromLng',
  'originLat', 'originLng', 'destLat', 'destLng', 'weight',
  'tempC', 'humidityPct', 'shockG',
] as const;

const BOOLEAN_FIELDS = ['marketingConsent', 'delivered'] as const;

export class CoerceTypesNode implements NodeInterface<CartographerState, 'validate-event', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'coerce-types';
  readonly 'outputs' = ['validate-event'] as const;

  private static toNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const n = Number(value);
      return isFinite(n) ? n : 0;
    }
    return 0;
  }

  private static toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true' || value === '1';
    return false;
  }

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'validate-event'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const coerced: Array<Record<string, unknown>> = state.mappedRecords.map((rec) => {
      const out: Record<string, unknown> = { ...rec };
      for (const field of NUMERIC_FIELDS) {
        if (field in out) out[field] = CoerceTypesNode.toNumber(out[field]);
      }
      for (const field of BOOLEAN_FIELDS) {
        if (field in out) out[field] = CoerceTypesNode.toBoolean(out[field]);
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
  }
}

export const coerceTypes = new CoerceTypesNode();
// #endregion coerce-types-node
