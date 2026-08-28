/**
 * sourceIntake: producer-feed fan-in for the canonical SourcePayload workload.
 *
 * Gather records must carry their projected async feed result. The feed placement
 * IRI determines ordering; clone state and alternate intake paths are rejected.
 */

import type { SourcePayload } from '../entities/SourcePayload.ts';
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';

import type { GatherRecordType } from '@studnicky/dagonizer/contracts';

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

}

export class CartographerSourceIntake {
  private constructor() { /* static-only */ }

  static mergeRecords(
    records: readonly GatherRecordType[],
  ): AsyncIterable<SourcePayload> {
    const feeds = new Map<SourcePayload['eventType'], AsyncIterable<SourcePayload>>();
    for (const record of records) {
      const eventType = CARTOGRAPHER_IRIS.eventTypeForFeedPlacement(record.source);
      if (eventType === null) {
        throw new TypeError(`Source intake record '${record.source}' is not a producer feed placement`);
      }
      feeds.set(eventType, CartographerSourceIntake.requireRecordFeed(record));
    }

    const streams = CARTOGRAPHER_IRIS.intakeEventTypes
      .map((eventType) => feeds.get(eventType))
      .filter((feed) => feed !== undefined);
    return SourcePayloadStream.roundRobin(streams);
  }

  private static requireRecordFeed(record: GatherRecordType): AsyncIterable<SourcePayload> {
    if (CartographerSourceIntake.isSourcePayloadIterable(record.result)) return record.result;
    throw new TypeError(`Source intake record '${record.source}' does not carry an async SourcePayload feed`);
  }

  private static isSourcePayloadIterable(value: unknown): value is AsyncIterable<SourcePayload> {
    return value !== null
      && typeof value === 'object'
      && Symbol.asyncIterator in value
      && typeof Reflect.get(value, Symbol.asyncIterator) === 'function';
  }

}
