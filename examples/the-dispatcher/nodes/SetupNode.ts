/**
 * SetupNode: pre-phase node — stamps per-run metadata.
 *
 * Runs before the entrypoint via a `PhaseNode` placement with phase: 'pre'.
 * Stamps `state.metadata.runId` so downstream nodes can correlate events
 * within one execution. Does NOT clear state fields so the HITL resume path
 * (operator sets state.response before resume()) is preserved across runs.
 *
 * Routes 'ready' always.
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';

export class SetupNode extends ScalarNode<DispatcherState, 'ready'> {
  readonly name = 'dispatcher-setup';
  readonly outputs = ['ready'] as const;

  override get outputSchema(): Record<'ready', SchemaObjectType> {
    return { 'ready': { 'type': 'object' } };
  }

  protected override executeOne(state: DispatcherState) {
    // Stamp a per-run identifier for diagnostics and metadata correlation.
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    state.setMetadata('runId', runId);
    return Promise.resolve(NodeOutputBuilder.of('ready'));
  }
}
