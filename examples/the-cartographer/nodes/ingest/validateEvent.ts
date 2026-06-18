/**
 * validate-event: shared ingest transform — coerced records → CanonicalEventVariants.
 *
 * The final shared node in every source's ingest sub-DAG. Assembles each
 * coerced record into the canonical event variant shape for its authoritative
 * eventType (carried on the SourcePayload), recovers type-owned identity extras
 * that survive un-stripped in parsedRecords, validates the required header, and
 * appends the valid variants to state.ingestedEvents. Records missing a
 * shipmentId or eventId are dropped (the source's reject path); the node never
 * throws.
 *
 * Type-owned identity extras: fields like customsStatus, tempC, etc. are
 * identity-mapped by the encoder under their canonical key and survive in
 * parsedRecords. IDENTITY_EXTRAS_BY_TYPE lists which extras belong to each
 * eventType; they are recovered into the mapped record before building the
 * variant so CanonicalEventVariantBuilder.fromSourcePayload can read them.
 *
 * Routes 'validated' (always — invalid records are filtered, not routed).
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';
import type { CanonicalEventVariant } from '../../entities/CanonicalEvent.ts';
import { CanonicalEventVariantBuilder } from '../../entities/CanonicalEvent.ts';
import { IDENTITY_EXTRAS_BY_TYPE } from '../../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@studnicky/dagonizer';

// #region validate-event-node
export class ValidateEventNode extends ScalarNode<CartographerState, 'validated', CartographerServices> {
  readonly 'name' = 'validate-event';
  readonly 'outputs' = ['validated'] as const;

  private static str(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'validated'>> {
    const source = state.currentSource;
    const eventType = source.eventType;
    const extras = IDENTITY_EXTRAS_BY_TYPE[eventType] ?? [];
    const variants: CanonicalEventVariant[] = [];

    for (let i = 0; i < state.mappedRecords.length; i++) {
      const rec = { ...state.mappedRecords[i] };
      const shipmentId = ValidateEventNode.str(rec['shipmentId']);
      const eventId    = ValidateEventNode.str(rec['eventId']);
      if (shipmentId.length === 0 || eventId.length === 0) continue;

      // Recover type-owned identity extras dropped by the static normalize FieldMap.
      // They survive un-stripped in parsedRecords under their canonical key (identity-mapped by the encoder).
      const parsed = state.parsedRecords[i];
      if (parsed !== undefined) {
        for (const key of extras) {
          if (!(key in rec) && key in parsed) rec[key] = parsed[key];
        }
      }

      const variant = CanonicalEventVariantBuilder.fromSourcePayload(source, rec);
      variants.push(variant);
    }

    state.ingestedEvents = variants;
    return NodeOutputBuilder.of('validated');
  }
}

export const validateEvent = new ValidateEventNode();
// #endregion validate-event-node
