import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import type { ExecutionResultType } from '@studnicky/dagonizer';
import { PipelineState, ValidateNode, TransformNode, dag } from '../dags/18-observability.ts';

// Inline subclass for hook capture — not in source files
class ObservingDispatcher extends Dagonizer<PipelineState> {
  flowStartCount = 0;
  flowEndCount = 0;
  nodeStartNames: string[] = [];
  nodeEndNames: string[] = [];

  protected override onFlowStart(_dagName: string, _state: PipelineState): void {
    this.flowStartCount++;
  }

  protected override onFlowEnd(
    _dagName: string,
    _state: PipelineState,
    _result: ExecutionResultType<PipelineState>,
  ): void {
    this.flowEndCount++;
  }

  protected override onNodeStart(
    nodeName: string,
    _state: PipelineState,
    _placementPath: readonly string[],
  ): void {
    this.nodeStartNames.push(nodeName);
  }

  protected override onNodeEnd(
    nodeName: string,
    _output: string | null,
    _state: PipelineState,
    _placementPath: readonly string[],
  ): void {
    this.nodeEndNames.push(nodeName);
  }
}

describe('18-observability: subclass hooks fire at execution boundaries', () => {
  it('state.value equals 10 after execution (validate sets 1, transform multiplies by 10)', async () => {
    const dispatcher = new ObservingDispatcher();
    dispatcher.registerNode(new ValidateNode());
    dispatcher.registerNode(new TransformNode());
    dispatcher.registerDAG(dag);

    const state = new PipelineState();
    const result = await dispatcher.execute('observe-demo', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.value, 10);
  });

  it('onFlowStart fires exactly once', async () => {
    const dispatcher = new ObservingDispatcher();
    dispatcher.registerNode(new ValidateNode());
    dispatcher.registerNode(new TransformNode());
    dispatcher.registerDAG(dag);

    await dispatcher.execute('observe-demo', new PipelineState());

    assert.equal(dispatcher.flowStartCount, 1);
  });

  it('onFlowEnd fires exactly once', async () => {
    const dispatcher = new ObservingDispatcher();
    dispatcher.registerNode(new ValidateNode());
    dispatcher.registerNode(new TransformNode());
    dispatcher.registerDAG(dag);

    await dispatcher.execute('observe-demo', new PipelineState());

    assert.equal(dispatcher.flowEndCount, 1);
  });

  it('onNodeStart fires for validate and transform', async () => {
    const dispatcher = new ObservingDispatcher();
    dispatcher.registerNode(new ValidateNode());
    dispatcher.registerNode(new TransformNode());
    dispatcher.registerDAG(dag);

    await dispatcher.execute('observe-demo', new PipelineState());

    assert.ok(
      dispatcher.nodeStartNames.includes('validate'),
      `nodeStartNames: ${JSON.stringify(dispatcher.nodeStartNames)}`,
    );
    assert.ok(
      dispatcher.nodeStartNames.includes('transform'),
      `nodeStartNames: ${JSON.stringify(dispatcher.nodeStartNames)}`,
    );
  });

  it('onNodeEnd fires for validate and transform', async () => {
    const dispatcher = new ObservingDispatcher();
    dispatcher.registerNode(new ValidateNode());
    dispatcher.registerNode(new TransformNode());
    dispatcher.registerDAG(dag);

    await dispatcher.execute('observe-demo', new PipelineState());

    assert.ok(
      dispatcher.nodeEndNames.includes('validate'),
      `nodeEndNames: ${JSON.stringify(dispatcher.nodeEndNames)}`,
    );
    assert.ok(
      dispatcher.nodeEndNames.includes('transform'),
      `nodeEndNames: ${JSON.stringify(dispatcher.nodeEndNames)}`,
    );
  });
});
