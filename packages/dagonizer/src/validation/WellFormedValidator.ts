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

type NodeEntry = DAG['nodes'][number];

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
   *   2. Structural: ScatterNode must have a non-empty `source` field.
   *   3. Structural: EmbeddedDAGNode must have a non-empty `dag` field.
   *   4. Structural: TerminalNode `outcome` must be 'completed' or 'failed'.
   *
   * Rules 2–4 are belt-and-suspenders guards; the Ajv schema enforces them
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

    // Nodes with outputs: apply target-resolution rules.
    // Each branch narrows `node` to the concrete placement type so `outputs`
    // is typed as `Record<string, string>` without a cast.
    if (type === 'SingleNode') {
      for (const [route, target] of Object.entries(node.outputs)) {
        if (!placementNames.has(target)) {
          violations.push(
            `Placement '${node.name}': route '${route}' targets '${target}', which does not exist in this DAG's placements.`,
          );
        }
      }
    } else if (type === 'ScatterNode') {
      for (const [route, target] of Object.entries(node.outputs)) {
        if (!placementNames.has(target)) {
          violations.push(
            `Placement '${node.name}': route '${route}' targets '${target}', which does not exist in this DAG's placements.`,
          );
        }
      }
    } else if (type === 'EmbeddedDAGNode') {
      for (const [route, target] of Object.entries(node.outputs)) {
        if (!placementNames.has(target)) {
          violations.push(
            `Placement '${node.name}': route '${route}' targets '${target}', which does not exist in this DAG's placements.`,
          );
        }
      }
    }
  }
}
