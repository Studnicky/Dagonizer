/**
 * WellFormedValidator: opt-in structural validator for authored DAG documents.
 *
 * Operates on an already-narrowed `DAG` (Ajv-validated wire shape). Inspects
 * placement structure to flag authoring errors that the type system cannot fully
 * catch (e.g. dangling route targets).
 *
 * Use from a CI lint script or a linting step in your authoring pipeline.
 * Never called by the runtime (Dagonizer.registerDAG stays unchanged).
 *
 * Usage:
 *   const violations = WellFormedValidator.check(dag);
 *   if (violations.length > 0) { ... }
 */

import type { DAG } from '../entities/dag/DAG.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';

/**
 * Opt-in structural validator for authored DAG documents.
 * Returns an array of human-readable violation messages; empty = well-formed.
 * Pure function: no Ajv, no I/O, no side effects.
 *
 * Called after `Validator.dag` has accepted the document. Checks semantic
 * constraints that the schema cannot express (e.g. route targets must name
 * real placements in the same DAG).
 */
export class WellFormedValidator {
  private constructor() { /* static class */ }

  /**
   * Check a DAG for well-formedness violations.
   *
   * Rules applied:
   *   1. All output targets must resolve to a placement name in dag.nodes.
   *      (Null routes are schema-invalid and will have been rejected by
   *      `Validator.dag` before this point; this rule catches dangling string
   *      targets that name non-existent placements.)
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
    node: DAGNodeType,
    placementNames: ReadonlySet<string>,
    violations: string[],
  ): void {
    // TerminalNode has no outputs; only check outcome.
    if (Placement.isTerminal(node)) {
      const outcome = node.outcome;
      if (outcome !== 'completed' && outcome !== 'failed') {
        violations.push(
          `Placement '${node.name}' (TerminalNode): outcome must be 'completed' or 'failed', got '${String(outcome)}'.`,
        );
      }
      return;
    }

    // PhaseNode has no outputs field (it is a lifecycle hook placement, not a routing placement).
    if (Placement.isPhase(node)) {
      return;
    }

    // SingleNode, ScatterNode, EmbeddedDAGNode: validate output route targets.
    WellFormedValidator.checkOutputTargets(node, placementNames, violations);
  }

  /**
   * Validate that every output route target names an existing placement.
   * Applies to SingleNode, ScatterNode, and EmbeddedDAGNode.
   */
  private static checkOutputTargets(
    node: DAGNodeType & { outputs: Record<string, string> },
    placementNames: ReadonlySet<string>,
    violations: string[],
  ): void {
    for (const [route, target] of Object.entries(node.outputs)) {
      if (!placementNames.has(target)) {
        violations.push(
          `Placement '${node.name}': route '${route}' targets '${target}', which does not exist in this DAG's placements.`,
        );
      }
    }
  }
}
