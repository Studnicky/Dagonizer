/**
 * DagStreamProducer: bridges a running inner DAG's node-result stream into a
 * push sink, so the discovered items of one DAG feed another DAG's scatter as a
 * back-pressured live source.
 *
 * Consumers EXTEND this (class extension — never a callback):
 *   - `executions()` supplies the running inner DAG as an
 *     `AsyncIterable<NodeResultType<NodeStateInterface>>` (an `Execution` is
 *     exactly this). The subclass wires its own dispatcher/state and returns
 *     `dispatcher.execute(dag, state)`.
 *   - `select(stage)` yields zero or more items from each node result (override,
 *     not a callback). For the crawl case it yields newly-discovered URLs.
 *
 * `produce` drives the inner execution and pushes each selected item. Because
 * `sink.push` is awaited, the inner DAG is back-pressured by the outer scatter's
 * drain rate — peak memory stays bounded.
 *
 * <T> is the streamed item type yielded to the outer scatter.
 */

import type { StreamProducerInterface } from '../contracts/StreamProducerInterface.js';
import type { StreamSinkInterface } from '../contracts/StreamSinkInterface.js';
import type { NodeResultType } from '../entities/node/NodeResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export abstract class DagStreamProducer<T> implements StreamProducerInterface<T> {
  protected abstract executions(): AsyncIterable<NodeResultType<NodeStateInterface>>;
  protected abstract select(stage: NodeResultType<NodeStateInterface>): Iterable<T>;

  async produce(sink: StreamSinkInterface<T>): Promise<void> {
    for await (const stage of this.executions()) {
      for (const item of this.select(stage)) {
        await sink.push(item);
      }
    }
  }
}
