import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GatherStrategies } from '@studnicky/dagonizer/core';
import type { GatherRecordType } from '@studnicky/dagonizer/contracts';

import { CartographerState } from '../../CartographerState.ts';
import { SourceIntakeGather } from '../../core/SourceIntakeGather.ts';
import type { SourcePayload } from '../../entities/SourcePayload.ts';
import { CartographerSourceIntake } from '../../nodes/sourceIntake.ts';

async function collect(stream: AsyncIterable<SourcePayload>): Promise<readonly SourcePayload[]> {
  const payloads: SourcePayload[] = [];
  for await (const payload of stream) payloads.push(payload);
  return payloads;
}

async function* feed(payload: SourcePayload): AsyncIterable<SourcePayload> {
  yield payload;
}

const payload: SourcePayload = {
  'sourceId': 'position-ping-json-none-0',
  'format': 'json',
  'compression': 'none',
  'mappingKey': 'position-ping',
  'eventType': 'position-ping',
  'payload': '[]',
};

class SourceIntakeRecordFixture {
  private constructor() { /* static-only */ }

  static withoutFeed(): GatherRecordType {
    return {
      'source': 'urn:noocodec:dag:cartographer/node/dag-feed-position-ping',
      'index': 0,
      'item': null,
      'output': 'success',
      'terminalOutcome': 'completed',
      'result': undefined,
      'cloneState': new CartographerState(),
    };
  }

  static withResult(): GatherRecordType {
    return {
      ...SourceIntakeRecordFixture.withoutFeed(),
      'result': feed(payload),
    };
  }

  static withCloneStateFeed(): GatherRecordType {
    const cloneState = new CartographerState();
    cloneState.sourceFeed = feed(payload);
    return {
      ...SourceIntakeRecordFixture.withoutFeed(),
      cloneState,
    };
  }
}

describe('SourceIntakeGather', () => {
  it('is registered under "source-intake"', () => {
    const strategy = GatherStrategies.resolve('source-intake');
    assert.ok(strategy, 'strategy must be registered');
    assert.equal(strategy.name, 'source-intake');
    assert.ok(strategy instanceof SourceIntakeGather, 'must be SourceIntakeGather instance');
  });

  // `record.result` for this gather is a live `AsyncIterable<SourcePayload>`
  // (see `CartographerSourceIntake.requireRecordFeed`, which throws when
  // `record.result` is not an async-iterable feed) — not JSON-serialisable
  // data. A JSON durable checkpoint cannot round-trip a live async generator,
  // so this gather cannot honestly participate in result-only compacted
  // replay regardless of the (single-field) `sourceFeed` projection it reads.
  it('declares transientResultSelection mode "full" (record.result is a live AsyncIterable handle, not JSON-durable data)', () => {
    const strategy = GatherStrategies.resolve('source-intake');
    assert.ok(strategy instanceof SourceIntakeGather);

    const selection = strategy.transientResultSelection();
    assert.equal(selection.mode, 'full');
    assert.deepEqual(selection.domainPaths, []);
    assert.deepEqual(selection.metadataKeys, []);
  });
});

describe('CartographerSourceIntake', () => {
  it('accepts the projected result from a producer feed placement', async () => {
    assert.deepEqual(
      await collect(CartographerSourceIntake.mergeRecords([SourceIntakeRecordFixture.withResult()])),
      [payload],
    );
  });

  it('rejects a producer record without its authoritative async feed', () => {
    assert.throws(
      () => CartographerSourceIntake.mergeRecords([SourceIntakeRecordFixture.withoutFeed()]),
      /does not carry an async SourcePayload feed/u,
    );
  });

  it('rejects clone-state feeds outside the projected result contract', () => {
    assert.throws(
      () => CartographerSourceIntake.mergeRecords([SourceIntakeRecordFixture.withCloneStateFeed()]),
      /does not carry an async SourcePayload feed/u,
    );
  });

  it('rejects source IDs outside the producer feed placement grammar', () => {
    assert.throws(
      () => CartographerSourceIntake.mergeRecords([{
        ...SourceIntakeRecordFixture.withResult(),
        'source': 'urn:noocodec:dag:cartographer/entrypoint/position-ping',
      }]),
      /is not a producer feed placement/u,
    );
  });
});
