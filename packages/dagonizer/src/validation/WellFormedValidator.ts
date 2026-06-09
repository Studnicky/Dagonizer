/**
 * WellFormedValidator: opt-in structural validator for authored DAG documents.
 *
 * Operates on an already-narrowed `DAG` (Ajv-validated wire shape). Inspects
 * placement structure to flag authoring anti-patterns that the Ajv schema
 * intentionally permits (null routes are valid engine input) but that authors
 * should avoid in canonical DAGs.
 *
 * Use from a CI lint script or a linting step in your authoring pipeline.
 * Never called by the runtime (Dagonizer.registerDAG stays unchanged).
 *
 * Usage:
 *   const violations = WellFormedValidator.check(dag);
 *   if (violations.length > 0) { ... }
 */

import type { DAG } from '../entities/dag/DAG.js';

type NodeEntry = DAG['nodes'][number];

/**
 * Opt-in structural validator for authored DAG documents.
 * Returns an array of human-readable violation messages; empty = well-formed.
 * Pure function: no Ajv, no I/O, no side effects.
 */
export class WellFormedValidator {
  private constructor() { /* static class */ }

  /**
   * Check a DAG for well-formedness violations.
   *
   * Rules applied:
   *   1. No bare null flow-ends. A null route target is always a violation.
   *      Replace null routes with an explicit TerminalNode placement.
   *   2. All non-null output targets must resolve to a placement name in dag.nodes.
   *   3. Structural: ScatterNode must have a non-empty `source` field.
   *   4. Structural: EmbeddedDAGNode must have a non-empty `dag` field.
   *   5. Structural: TerminalNode `outcome` must be 'completed' or 'failed'.
   *
   * Rules 3–5 are belt-and-suspenders guards; the Ajv schema enforces them
   * at load time. They are included for completeness when operating on
   * already-validated values constructed programmatically.
   *
   * @param dag - A schema-validated DAG object.
   * @returns Array of human-readable violation messages. Empty = well-formed.
   */
  static check(dag: DAG): readonly string[] {
    const violations: string[] = [];

    // Build a set of all placement names for target resolution.
    const placementNames = new Set<string>(dag.nodes.map((n) => n.name));

    for (const node of dag.nodes) {
      WellFormedValidator.checkPlacement(node, placementNames, violations);
    }

    return violations;
  }

  private static checkPlacement(
    node: NodeEntry,
    placementNames: ReadonlySet<string>,
    violations: string[],
  ): void {
    const type = node['@type'];

    // TerminalNode has no outputs; only check outcome.
    if (type === 'TerminalNode') {
      const outcome = node.outcome;
      if (outcome !== 'completed' && outcome !== 'failed') {
        violations.push(
          `Placement '${node.name}' (TerminalNode): outcome must be 'completed' or 'failed', got '${String(outcome)}'.`,
        );
      }
      return;
    }

    // PhaseNode has no outputs field (it is a lifecycle hook placement, not a routing placement).
    if (type === 'PhaseNode') {
      return;
    }

    // ScatterNode structural: source must be non-empty (schema enforces this; belt-and-suspenders).
    if (type === 'ScatterNode') {
      if (!node.source || node.source.length === 0) {
        violations.push(
          `Placement '${node.name}' (ScatterNode): 'source' is empty or missing. A ScatterNode requires a non-empty source field.`,
        );
      }
    }

    // EmbeddedDAGNode structural: dag must be non-empty (schema enforces this; belt-and-suspenders).
    if (type === 'EmbeddedDAGNode') {
      if (!node.dag || node.dag.length === 0) {
        violations.push(
          `Placement '${node.name}' (EmbeddedDAGNode): 'dag' is empty or missing. An EmbeddedDAGNode requires a non-empty dag reference.`,
        );
      }
    }

    // Nodes with outputs: apply null-route and target-resolution rules.
    if (type === 'SingleNode' || type === 'ScatterNode' || type === 'EmbeddedDAGNode') {
      const outputs = node.outputs as Record<string, string | null>;

      for (const [route, target] of Object.entries(outputs)) {
        if (target === null) {
          violations.push(
            `Placement '${node.name}': route '${route}' targets null. Route to a TerminalNode instead of a bare null end-of-flow.`,
          );
        } else {
          // Non-null target must name an existing placement.
          if (!placementNames.has(target)) {
            violations.push(
              `Placement '${node.name}': route '${route}' targets '${target}', which does not exist in this DAG's placements.`,
            );
          }
        }
      }
    }
  }
}
