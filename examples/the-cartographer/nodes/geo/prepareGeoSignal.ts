import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorBuilder } from '../../entities/GeoSignalDescriptor.ts';
import type { GeoSignalDescriptor } from '../../entities/GeoSignalDescriptor.ts';
import { CallingCode } from '../../geo/CallingCode.ts';
import { SignalWeight } from '../../entities/SignalWeight.ts';
import {
  Batch,
  MonadicNode,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

type GeoSignalKind = 'coords' | 'address' | 'ip' | 'code' | 'phone' | 'locale';
type PrepareGeoSignalOutput = 'present' | 'missing';

// #region prepare-geo-signal-node
export class PrepareGeoSignalNode extends MonadicNode<CartographerState, PrepareGeoSignalOutput> {
  readonly 'outputs' = ['present', 'missing'] as const;
  readonly #kind: GeoSignalKind;
  readonly #name: string;

  constructor(name: string, kind: GeoSignalKind) {
    super();
    this.#name = name;
    this.#kind = kind;
  }

  get name(): string {
    return this.#name;
  }

  override get outputSchema(): Record<PrepareGeoSignalOutput, SchemaObjectType> {
    return {
      'present': { 'type': 'object' },
      'missing': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<PrepareGeoSignalOutput, CartographerState>> {
    const present: Array<{ readonly id: string; readonly state: CartographerState }> = [];
    const missing: Array<{ readonly id: string; readonly state: CartographerState }> = [];

    for (const item of batch) {
      const descriptor = this.#descriptor(item.state);
      if (descriptor === null) {
        item.state.candidate = GeoResolutionBuilder.from({ 'source': this.#kind, 'weight': 0 });
        missing.push(item);
      } else {
        item.state.setMetadata('geo-signal', descriptor);
        present.push(item);
      }
    }

    const routed = new Map<PrepareGeoSignalOutput, Batch<CartographerState>>();
    if (present.length > 0) routed.set('present', Batch.from(present));
    if (missing.length > 0) routed.set('missing', Batch.from(missing));
    return routed;
  }

  #descriptor(state: CartographerState): GeoSignalDescriptor | null {
    const body = state.canonical.body;
    switch (this.#kind) {
      case 'coords':
        return Number.isFinite(body.latitude)
          && Number.isFinite(body.longitude)
          && (body.latitude !== 0 || body.longitude !== 0)
          && Math.abs(body.latitude) <= 90
          && Math.abs(body.longitude) <= 180
          ? GeoSignalDescriptorBuilder.from({
            'kind': 'coords',
            'weight': SignalWeight.for('coords'),
            'lat': body.latitude,
            'lng': body.longitude,
          })
          : null;
      case 'address':
        return body.address.length > 0
          ? GeoSignalDescriptorBuilder.from({
            'kind': 'address',
            'weight': SignalWeight.for('address'),
            'address': body.address,
          })
          : null;
      case 'ip':
        return body.ipAddress.length > 0
          ? GeoSignalDescriptorBuilder.from({
            'kind': 'ip',
            'weight': SignalWeight.for('ip'),
            'ipAddress': body.ipAddress,
          })
          : null;
      case 'code':
        return body.countryCode.length > 0
          ? GeoSignalDescriptorBuilder.from({
            'kind': 'code',
            'weight': SignalWeight.for('code'),
            'countryCode': body.countryCode,
          })
          : null;
      case 'phone':
        return body.phone.length > 0 && CallingCode.countryFor(body.phone).length > 0
          ? GeoSignalDescriptorBuilder.from({
            'kind': 'phone',
            'weight': SignalWeight.for('phone'),
            'phone': body.phone,
          })
          : null;
      case 'locale':
        return body.localeTag.length > 0
          ? GeoSignalDescriptorBuilder.from({
            'kind': 'locale',
            'weight': SignalWeight.for('locale'),
            'localeTag': body.localeTag,
          })
          : null;
    }
  }
}

export const prepareGeoCoords = new PrepareGeoSignalNode('prepare-geo-coords', 'coords');
export const prepareGeoAddress = new PrepareGeoSignalNode('prepare-geo-address', 'address');
export const prepareGeoIp = new PrepareGeoSignalNode('prepare-geo-ip', 'ip');
export const prepareGeoCode = new PrepareGeoSignalNode('prepare-geo-code', 'code');
export const prepareGeoPhone = new PrepareGeoSignalNode('prepare-geo-phone', 'phone');
export const prepareGeoLocale = new PrepareGeoSignalNode('prepare-geo-locale', 'locale');
// #endregion prepare-geo-signal-node
