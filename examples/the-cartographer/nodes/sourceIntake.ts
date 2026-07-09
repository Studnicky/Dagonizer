/**
 * sourceIntake: stream construction helpers for source-payload compatibility flows.
 *
 * The current runnable Cartographer topology uses producer feed DAGs. These
 * helpers remain for source-payload stream examples and compatibility DAGs that
 * rebuild a deterministic merged SourcePayload stream.
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
    return EventStreamSource.streamProducer(state.eventConfig, eventType, totalCount);
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
      streams.push(CartographerSourceIntake.recordFeed(record) ?? CartographerSourceIntake.streamFor(state, source));
    }
    return SourcePayloadStream.roundRobin(streams);
  }

  private static recordFeed(record: GatherRecordType): AsyncIterable<SourcePayload> | null {
    if (CartographerSourceIntake.isSourcePayloadIterable(record.result)) return record.result;
    const sourceFeed = Reflect.get(record.cloneState, 'sourceFeed');
    return CartographerSourceIntake.isSourcePayloadIterable(sourceFeed) ? sourceFeed : null;
  }

  private static isSourcePayloadIterable(value: unknown): value is AsyncIterable<SourcePayload> {
    return value !== null
      && typeof value === 'object'
      && Symbol.asyncIterator in value
      && typeof Reflect.get(value, Symbol.asyncIterator) === 'function';
  }

  private static sourceType(source: string): CartographerEventType | null {
    const entrypointMarker = '/entrypoint/';
    const entrypointIndex = source.indexOf(entrypointMarker);
    if (entrypointIndex >= 0) {
      return CartographerSourceIntake.eventTypeFromLabel(
        decodeURIComponent(source.slice(entrypointIndex + entrypointMarker.length)),
      );
    }

    const nodeMarker = '/node/dag-feed-';
    const nodeIndex = source.indexOf(nodeMarker);
    if (nodeIndex >= 0) {
      return CartographerSourceIntake.eventTypeFromLabel(
        decodeURIComponent(source.slice(nodeIndex + nodeMarker.length)),
      );
    }

    return null;
  }

  private static eventTypeFromLabel(label: string): CartographerEventType | null {
    return CARTOGRAPHER_IRIS.intakeEventTypes.includes(label as CartographerEventType)
      ? (label as CartographerEventType)
      : null;
  }
}
