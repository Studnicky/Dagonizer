/**
 * authoring-derive.topology: DAGDeriver research-agent example for the docs.
 *
 * No side effects, no top-level await. Each operation declares what it needs
 * (`hardRequired`) and what it produces (`produces`); DAGDeriver matches
 * produces ↔ hardRequired to derive the topology. Adding a new operation is a
 * one-line registration; the data graph derives the edges.
 *
 * Documentation carve: docs/guide/authoring.md (#research-agent).
 */

// #region research-agent
import { DAGDeriver } from '@studnicky/dagonizer/derive';
import { NodeOutputBuilder, NodeStateBase, ScalarNode } from '@studnicky/dagonizer';
import type { OperationContractFragment } from '@studnicky/dagonizer/contracts';

export class ResearchState extends NodeStateBase {
  query     = '';
  intent    = '';
  candidates: string[] = [];
  shortlist:  string[] = [];
  response  = '';
}

export class ClassifyIntentNode extends ScalarNode<ResearchState, 'lookup' | 'similar' | 'off-topic'> {
  readonly name    = 'classify-intent';
  readonly outputs = ['lookup', 'similar', 'off-topic'] as const;
  override readonly contract: OperationContractFragment = { hardRequired: ['query'], produces: ['intent'] };

  protected override async executeOne(state: ResearchState) {
    state.intent = 'lookup';
    return NodeOutputBuilder.of('lookup');
  }
}

export class FetchCandidatesNode extends ScalarNode<ResearchState, 'success' | 'empty'> {
  readonly name    = 'fetch-candidates';
  readonly outputs = ['success', 'empty'] as const;
  override readonly contract: OperationContractFragment = { hardRequired: ['intent'], produces: ['candidates'] };

  protected override async executeOne(state: ResearchState) {
    state.candidates = ['a', 'b'];
    return NodeOutputBuilder.of('success');
  }
}

export class RankNode extends ScalarNode<ResearchState, 'success'> {
  readonly name    = 'rank';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = { hardRequired: ['candidates'], produces: ['shortlist'] };

  protected override async executeOne(state: ResearchState) {
    state.shortlist = state.candidates.slice(0, 1);
    return NodeOutputBuilder.of('success');
  }
}

export class ComposeNode extends ScalarNode<ResearchState, 'success' | 'retry'> {
  readonly name    = 'compose';
  readonly outputs = ['success', 'retry'] as const;
  override readonly contract: OperationContractFragment = { hardRequired: ['shortlist'], produces: ['response'] };

  protected override async executeOne(state: ResearchState) {
    state.response = `from ${state.shortlist.join(', ')}`;
    return NodeOutputBuilder.of('success');
  }
}

export const dag = DAGDeriver.derive({
  name:       'research-agent',
  version:    '1',
  entrypoint: 'classify-intent',
  nodes:      [new ClassifyIntentNode(), new FetchCandidatesNode(), new RankNode(), new ComposeNode()],
  annotations: {
    terminals: { 'classify-intent': [{ outcome: 'off-topic', target: 'compose' }] },
  },
});
// #endregion research-agent
