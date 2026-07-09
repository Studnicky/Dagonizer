/**
 * score-signals: validity-gated weighted geo signal scoring node.
 *
 * Reads the canonical event body and emits one GeoSignalDescriptor per
 * present, valid signal modality. Each descriptor carries the modality kind
 * and its base weight from SignalWeight.
 *
 * Validity gates (signals that fail are excluded, not zero-weighted):
 *   coords   — both lat and lng must be finite, not both zero, and within
 *               WGS-84 bounds (|lat| ≤ 90, |lng| ≤ 180).
 *   address  — non-empty string.
 *   ip       — non-empty string.
 *   code     — non-empty string.
 *   phone    — non-empty string AND CallingCode.countryFor(phone) returns a
 *               non-empty ISO-2 code; unparseable phones are excluded.
 *   locale   — non-empty string.
 *
 * The composite code+locale agreement weight (SignalWeight.COMPOSITE_CODE_LOCALE)
 * is computed downstream in the gather phase, not here.
 *
 * Always routes 'scored'. The downstream scatter handles an empty geoSignals
 * array via its own 'empty' aggregate outcome.
 */

import type { CartographerState } from '../../CartographerState.ts';
import {
  GeoSignalDescriptorBuilder,
} from '../../entities/GeoSignalDescriptor.ts';
import type { GeoSignalDescriptor } from '../../entities/GeoSignalDescriptor.ts';
import { SignalWeight } from '../../entities/SignalWeight.ts';
import { CallingCode } from '../../geo/CallingCode.ts';

import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region score-signals-node
export class ScoreSignalsNode extends MonadicNode<CartographerState, 'scored'> {
  readonly '@id' = 'urn:noocodec:node:score-signals';
  readonly 'name' = 'score-signals';
  readonly 'outputs' = ['scored'] as const;

  override get outputSchema(): Record<'scored', SchemaObjectType> {
    return {
      'scored': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'scored', CartographerState>> {
    for (const item of batch) {
      const body = item.state.canonical.body;

    const lat = body.latitude;
    const lng = body.longitude;
    const ipAddress   = body.ipAddress;
    const localeTag   = body.localeTag;
    const countryCode = body.countryCode;
    const address     = body.address;
    const phone       = body.phone;

    const descriptors: GeoSignalDescriptor[] = [];

    // coords: finite, not both zero, within WGS-84 bounds
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      (lat !== 0 || lng !== 0) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
    ) {
      descriptors.push(GeoSignalDescriptorBuilder.from({
        'kind':   'coords',
        'weight': SignalWeight.for('coords'),
        'lat':    lat,
        'lng':    lng,
      }));
    }

    // address: non-empty
    if (address.length > 0) {
      descriptors.push(GeoSignalDescriptorBuilder.from({
        'kind':    'address',
        'weight':  SignalWeight.for('address'),
        'address': address,
      }));
    }

    // ip: non-empty
    if (ipAddress.length > 0) {
      descriptors.push(GeoSignalDescriptorBuilder.from({
        'kind':      'ip',
        'weight':    SignalWeight.for('ip'),
        'ipAddress': ipAddress,
      }));
    }

    // code: non-empty
    if (countryCode.length > 0) {
      descriptors.push(GeoSignalDescriptorBuilder.from({
        'kind':        'code',
        'weight':      SignalWeight.for('code'),
        'countryCode': countryCode,
      }));
    }

    // phone: non-empty AND parseable calling code
    if (phone.length > 0 && CallingCode.countryFor(phone).length > 0) {
      descriptors.push(GeoSignalDescriptorBuilder.from({
        'kind':   'phone',
        'weight': SignalWeight.for('phone'),
        'phone':  phone,
      }));
    }

    // locale: non-empty
    if (localeTag.length > 0) {
      descriptors.push(GeoSignalDescriptorBuilder.from({
        'kind':      'locale',
        'weight':    SignalWeight.for('locale'),
        'localeTag': localeTag,
      }));
    }

      item.state.geoSignals = descriptors;
      item.state.geoCandidates = [];
    }

    return RoutedBatch.create('scored', batch);
  }
}

export const scoreSignals = new ScoreSignalsNode();
// #endregion score-signals-node
