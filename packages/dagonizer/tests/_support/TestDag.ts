/**
 * TestDag: shared static factory for building minimal `DAGType` skeletons
 * in unit tests.
 *
 * Six files duplicate an identical freestanding `makeDAG(name, entrypoint,
 * nodes)` function (batch-native-executor, batch-walk, cytoscape-graph,
 * embedded-dag, embedded-dag-bounded-memory, streaming). All produce the
 * same `DAGType` skeleton — the same required fields, the same IRI pattern,
 * the same version literal.
 *
 * `TestDag.of` is the single shared replacement. It does NOT encode a
 * specific topology; tests still supply their own `nodes` arrays. The factory
 * only handles the boilerplate fields that are identical across all callers:
 * `@context`, `@id`, `@type`, `version`.
 *
 * Note: `embedded-dag-bounded-memory.test.ts` additionally wraps the result
 * in `Validator.dag.validate()`. That validation concern belongs to the
 * test, not the fixture — the test keeps that call, replacing only the inner
 * object construction with `TestDag.of(...)`.
 */

import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';

export class TestDag {
  private constructor() { /* static class */ }

  /**
   * Build a minimal `DAGType` skeleton.
   *
   * Fills the boilerplate fields (`@context`, `@id`, `@type`, `version`)
   * using the canonical `DAG_CONTEXT` and the standard IRI pattern
   * `urn:noocodex:dag:<name>`. Callers supply the test-specific
   * primary entrypoint and `nodes` array.
   *
   * @param name       - Registered DAG name; also used for the `@id` IRI.
   * @param entrypoint - Name of the entrypoint placement node.
   * @param nodes      - Placement node definitions (SingleNode, TerminalNode, etc.).
   */
  static of(
    name: string,
    entrypoint: string,
    nodes: DAGType['nodes'],
  ): DAGType {
    return {
      '@context':  DAG_CONTEXT,
      '@id':       `urn:noocodex:dag:${name}`,
      '@type':     'DAG',
      name,
      'version':   '1',
      'entrypoints': { 'main': entrypoint },
      nodes,
    };
  }
}
