/**
 * SignalWeight: single source of truth for geo signal base weights and the
 * composite code+locale agreement weight.
 *
 * Weights reflect how reliable each modality is for geo resolution:
 * coords (1.0) > address (0.8) > ip (0.55) > code (0.35) > phone (0.30) > locale (0.2).
 *
 * The composite code+locale weight (0.45) is consumed by the gather phase when
 * both `code` and `locale` descriptors agree on the same country; it supersedes
 * either individual weight.
 *
 * @module
 */

import type { GeoSignalDescriptor } from './GeoSignalDescriptor.ts';

type GeoSignalKind = GeoSignalDescriptor['kind'];

const WEIGHT_TABLE: Readonly<Record<GeoSignalKind, number>> = {
  'coords':  1.0,
  'address': 0.8,
  'ip':      0.55,
  'code':    0.35,
  'phone':   0.30,
  'locale':  0.2,
} as const;

export class SignalWeight {
  private constructor() { /* static-only */ }

  /**
   * Return the base weight for a geo signal kind.
   * coords 1.0 > address 0.8 > ip 0.55 > code 0.35 > phone 0.30 > locale 0.2.
   */
  static for(kind: GeoSignalKind): number {
    return WEIGHT_TABLE[kind];
  }

  /**
   * Composite code+locale agreement weight (0.45). Consumed by the gather phase
   * when both code and locale descriptors resolve to the same ISO-2 country.
   */
  static readonly COMPOSITE_CODE_LOCALE: number = 0.45;
}
