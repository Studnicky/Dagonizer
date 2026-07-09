/**
 * 05-embedded-dags/dags: pure module — state, nodes, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/05-embedded-dags.ts (the executable entry point).
 */

import {
  Batch,
  DAGBuilder,
  DAG_CONTEXT,
  DAGIdentity,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// State: fields live on the same class; inputs / outputs control which
// ones cross the EmbeddedDAGNode boundary
// ---------------------------------------------------------------------------

export class IncrementState extends NodeStateBase {
  seed    = 0;  // parent input value
  result  = 0;  // parent output value (written back via stateMapping.outputs)
  payload = 0;  // the field the child DAG operates on
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

// The child DAG's working node: increments the payload field
export class IncrementNode extends MonadicNode<IncrementState, 'success'> {
  readonly name = 'increment';
  readonly '@id' = 'urn:noocodec:node:increment';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  override async execute(batch: Batch<IncrementState>) {
    for (const item of batch) {
      item.state.payload = item.state.payload + 1;
    }
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

// ---------------------------------------------------------------------------
// Child (deep) DAG: runs the increment node then hands control back
// ---------------------------------------------------------------------------

export const childDAGIri = 'urn:noocodec:dag:child' as const;
export const parentDAGIri = 'urn:noocodec:dag:parent' as const;
const placement = (dagIri: string, placementIdentifier: string): string => DAGIdentity.placementId(dagIri, placementIdentifier);

// #region child-dag
export const child: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': childDAGIri,
  '@type':     'DAG',
  "name":        'child',
  "version":     '1',
  "entrypoints": { "main": placement(childDAGIri, 'inc') },
  "nodes": [
    {
      '@id': placement(childDAGIri, 'inc'),
      '@type': 'SingleNode',
      "name":    'inc',
      "node":    'urn:noocodec:node:increment',
      "outputs": { "success": placement(childDAGIri, 'child-end') },  // child DAG ends at TerminalNode
    },
    {
      '@id': placement(childDAGIri, 'child-end'),
      '@type':   'TerminalNode',
      "name":    'child-end',
      "outcome": 'completed',
    },
  ],
};
// #endregion child-dag

// ---------------------------------------------------------------------------
// Parent DAG: invokes the child via EmbeddedDAGNode (cardinality 1)
// ---------------------------------------------------------------------------

// #region parent-dag
export const parent: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': parentDAGIri,
  '@type':     'DAG',
  "name":        'parent',
  "version":     '1',
  "entrypoints": { "main": placement(parentDAGIri, 'invoke') },
  "nodes": [
    {
      '@id': placement(parentDAGIri, 'invoke'),
      '@type': 'EmbeddedDAGNode',              // nested DAG invocation, cardinality 1
      "name":    'invoke',
      "dag":     childDAGIri,                       // run the registered child DAG
      // #region state-mapping
      // stateMapping: seeds child fields from parent, and copies child fields back
      "stateMapping": {
        // inputs: seeds child state before the body runs
        // { childKey: parentPath }
        "input":  { "payload": 'seed' },        // child.payload ← parent.seed

      // outputs: writes child fields back to parent after the body returns
      // { parentPath: childKey }
      "output": { "result": 'payload' },       // parent.result ← child.payload
      },
      // #endregion state-mapping
      // Routes for the EmbeddedDAGNode outcome (success / error)
      "outputs": { "success": placement(parentDAGIri, 'end'), "error": placement(parentDAGIri, 'end-error') },
    },
    {
      '@id': placement(parentDAGIri, 'end'),
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
    {
      '@id': placement(parentDAGIri, 'end-error'),
      '@type':   'TerminalNode',
      "name":    'end-error',
      "outcome": 'failed',
    },
  ],
};
// #endregion parent-dag

// ---------------------------------------------------------------------------
// DAGBuilder equivalent of the parent DAG above (typed stateMapping)
// ---------------------------------------------------------------------------

// #region builder-state-mapping
// DAGBuilder equivalent of the JSON-LD parent DAG — typed inputs/outputs
// narrow the stateMapping keys to paths that exist on IncrementState at
// compile time.
const builderParent = new DAGBuilder(parentDAGIri, '1').entrypoints({ main: placement(parentDAGIri, 'invoke') });
builderParent.embed<IncrementState, IncrementState>(
  placement(parentDAGIri, 'invoke'),
  childDAGIri,
  { success: placement(parentDAGIri, 'end'), error: placement(parentDAGIri, 'end-error') },
  {
    inputs:  { payload: 'seed' },    // child.payload ← parent.seed
    outputs: { result: 'payload' },  // parent.result ← child.payload
  },
);
builderParent.terminal(placement(parentDAGIri, 'end'));
builderParent.terminal(placement(parentDAGIri, 'end-error'), { outcome: 'failed' });
// #endregion builder-state-mapping
