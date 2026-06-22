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
import { TimeNormalizer } from '../../services.ts';
import { GeoErrorRecord } from '../../errors/GeoErrorRecord.ts';
import type { GeoErrorRecordType } from '../../errors/GeoErrorRecord.ts';

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// #region coerce-types-node
const NUMERIC_FIELDS = [
  'scanSeq', 'latitude', 'longitude', 'legFromLat', 'legFromLng',
  'originLat', 'originLng', 'destLat', 'destLng', 'weight',
  'tempC', 'humidityPct', 'shockG',
] as const;

const BOOLEAN_FIELDS = ['marketingConsent', 'delivered'] as const;

export class CoerceTypesNode extends ScalarNode<CartographerState, 'validate-event'> {
  readonly 'name' = 'coerce-types';
  readonly 'outputs' = ['validate-event'] as const;

  override get outputSchema(): Record<'validate-event', SchemaObjectType> {
    return {
      'validate-event': { 'type': 'object' },
    };
  }

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

  protected override async executeOne(state: CartographerState, _context: NodeContextType): Promise<NodeOutputType<'validate-event'>> {
    const lineItemErrors: GeoErrorRecordType[] = [];
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
        } catch (caught) {
          // Capture the lineItems parse failure as data; degrade to empty array.
          lineItemErrors.push(GeoErrorRecord.capture('coerce-types', caught, `source=${state.currentSource.sourceId}`));
          out['lineItems'] = [];
        }
      }
      return out;
    });
    state.mappedRecords = coerced;
    if (lineItemErrors.length > 0) {
      state.capturedErrors = [...state.capturedErrors, ...lineItemErrors];
    }
    return NodeOutputBuilder.of('validate-event');
  }
}

export const coerceTypes = new CoerceTypesNode();
// #endregion coerce-types-node
