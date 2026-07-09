import type { GatherRecordType } from '../contracts/GatherExecution.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

type ProjectionInputType = {
  readonly source: string;
  readonly output: string;
  readonly terminalOutcome: 'completed' | 'failed' | null;
  readonly state: NodeStateInterface;
  readonly accessor: StateAccessorInterface;
  readonly resultField?: string;
  readonly index?: number | null;
  readonly item?: unknown;
};

export class GatherRecordProjector {
  private constructor() { /* static-only */ }

  static project(input: ProjectionInputType): GatherRecordType {
    return {
      'source': input.source,
      'index': input.index ?? null,
      'item': input.item,
      'output': input.output,
      'terminalOutcome': input.terminalOutcome,
      'result': input.resultField === undefined
        ? undefined
        : input.accessor.get(input.state, input.resultField),
      'cloneState': input.state,
    };
  }
}
