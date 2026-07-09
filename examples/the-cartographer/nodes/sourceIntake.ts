/**
 * sourceIntake: stream construction helpers for Cartographer's open intake gather.
 *
 * The intake gather is entrypoint-driven: each data-type entrypoint is a
 * canonical entrypoint IRI, and the gather/source helpers open the matching
 * typed source stream directly.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { SourcePayload } from '../entities/SourcePayload.ts';
import type { CanonicalEventVariant } from '../entities/index.ts';
import { EventStreamSource } from '../services/EventStreamSource.ts';
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';

import type { GatherRecordType } from '@studnicky/dagonizer/contracts';
import type { NodeStateInterface } from '@studnicky/dagonizer/types';

type CartographerEventType = CanonicalEventVariant['eventType'];
type CartographerIntakeState = NodeStateInterface & Pick<CartographerState, 'eventConfig' | 'streamCount'>;

class SourcePayloadStream {
  private constructor() { /* static-only */ }

  static async *roundRobin(streams: readonly AsyncIterable<SourcePayload>[]): AsyncIterable<SourcePayload> {
    const active = streams.map((stream) => stream[Symbol.asyncIterator]());
    while (active.length > 0) {
      for (let i = 0; i < active.length;) {
        const step = await active[i]?.next();
        if (step === undefined || step.done === true) {
          active.splice(i, 1);
          continue;
        }
        yield step.value;
        i++;
      }
    }
  }

  static async *skip(stream: AsyncIterable<SourcePayload>, count: number): AsyncIterable<SourcePayload> {
    let skipped = 0;
    for await (const item of stream) {
      if (skipped < count) {
        skipped++;
        continue;
      }
      yield item;
    }
  }

  static async *empty(): AsyncIterable<SourcePayload> {
    return;
  }
}

export class CartographerSourceIntake {
  private constructor() { /* static-only */ }

  static isState(state: NodeStateInterface): state is CartographerIntakeState {
    const eventConfig = Reflect.get(state, 'eventConfig');
    return eventConfig !== null
      && typeof eventConfig === 'object'
      && typeof Reflect.get(state, 'streamCount') === 'number';
  }

  static streamFor(state: CartographerIntakeState, eventType: CartographerEventType): AsyncIterable<SourcePayload> {
    const totalCount = state.streamCount > 0 ? state.streamCount : undefined;
    return CartographerSourceIntake.filterType(
      EventStreamSource.streamTyped(state.eventConfig, totalCount),
      eventType,
    );
  }

  static mergedFor(state: CartographerState, resumeAfter: number = 0): AsyncIterable<SourcePayload> {
    const streams = CARTOGRAPHER_IRIS.intakeEventTypes.map((eventType) =>
      CartographerSourceIntake.streamFor(state, eventType),
    );
    const merged = SourcePayloadStream.roundRobin(streams);
    return resumeAfter > 0 ? SourcePayloadStream.skip(merged, resumeAfter) : merged;
  }

  static mergeRecords(
    records: readonly GatherRecordType[],
    state: NodeStateInterface,
  ): AsyncIterable<SourcePayload> {
    if (!CartographerSourceIntake.isState(state)) return SourcePayloadStream.empty();
    const streams: AsyncIterable<SourcePayload>[] = [];
    for (const source of CARTOGRAPHER_IRIS.intakeEventTypes) {
      const record = records.find((candidate) => CartographerSourceIntake.sourceType(candidate.source) === source);
      if (record === undefined) continue;
      streams.push(CartographerSourceIntake.streamFor(state, source));
    }
    return SourcePayloadStream.roundRobin(streams);
  }

  private static sourceType(source: string): CartographerEventType | null {
    const marker = '/entrypoint/';
    const index = source.indexOf(marker);
    if (index < 0) return null;
    const label = decodeURIComponent(source.slice(index + marker.length));
    return CARTOGRAPHER_IRIS.intakeEventTypes.includes(label as CartographerEventType)
      ? (label as CartographerEventType)
      : null;
  }

  private static async *filterType(
    stream: AsyncIterable<SourcePayload>,
    eventType: CartographerEventType,
  ): AsyncIterable<SourcePayload> {
    for await (const item of stream) {
      if (item.eventType === eventType) yield item;
    }
  }
}
