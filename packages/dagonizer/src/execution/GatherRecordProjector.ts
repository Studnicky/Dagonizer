import type { GatherRecordType } from '../contracts/GatherExecution.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

type GatherRecordProducerType =
  | EmbeddedDAGNodeType
  | ScatterNodeType
  | SingleNodePlacementType;

type ProjectionInputType = {
  readonly source: string;
  readonly producer: GatherRecordProducerType;
  readonly output: string;
  readonly terminalOutcome: 'completed' | 'failed' | null;
  readonly state: NodeStateInterface;
  readonly accessor: StateAccessorInterface;
  readonly index?: number | null;
  readonly item?: unknown;
};

export class GatherRecordProjector {
  private constructor() { /* static-only */ }

  static project(input: ProjectionInputType): GatherRecordType {
    const resultField = GatherRecordProjector.resultField(input.producer);
    return {
      'source': input.source,
      'index': input.index ?? null,
      'item': input.item,
      'output': input.output,
      'terminalOutcome': input.terminalOutcome,
      'result': resultField === null
        ? undefined
        : input.accessor.get(input.state, resultField),
      'cloneState': input.state,
    };
  }

  private static resultField(producer: GatherRecordProducerType): string | null {
    if (producer['@type'] === 'EmbeddedDAGNode') {
      return producer.gatherResult?.resultField ?? null;
    }
    if (producer['@type'] === 'ScatterNode') {
      return producer.gather.resultField ?? null;
    }
    return null;
  }
}
