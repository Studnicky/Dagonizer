/**
 * kill-registry: a registry fixture whose scatter-body node SILENTLY KILLS its
 * worker thread mid-request for one specific item, with no result/error sent.
 *
 * This is the real-death proof for Law 4 (parent backstop guarantees
 * termination) + Law 8 (at-least-once under worker kill). It reconstructs the
 * SAME bundle as the conformance registry (same DAG names: law8 runner, the
 * scatter-item-body DAG, ConformanceState) but swaps the `scatter-counter`
 * node for `scatter-killer`:
 *
 *   - For most items: behaves exactly like scatter-counter (value += 1) so the
 *     item completes and acks normally.
 *   - For the KILL item (currentItem === KILL_ITEM): calls process.exit(),
 *     terminating THIS worker thread before any result is sent. The parent's
 *     worker.on('exit') fires → failChannel → the in-flight runDag resolves to
 *     a transport error → the scatter treats it as an infra failure → the item
 *     is left un-acked for resume.
 *
 * Resume uses the NORMAL conformance registry (registry.js): a fresh worker
 * reconstructs scatter-counter (no kill) so the un-acked items reprocess to
 * completion. Using a different registry for resume is intentional — it mirrors
 * the failingContainer/freshContainer split the conformance Law 8 harness uses.
 *
 * The host runs this module inside the worker; process.exit there kills only
 * the worker thread, not the parent.
 */

import type {
  NodeInterface,
  RegistryBundleInterface,
  RegistryModuleInterface,
} from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';
import { ConformanceRegistry } from '@noocodex/dagonizer/testing';
import type { ConformanceState } from '@noocodex/dagonizer/testing';
import type { NodeOutputInterface } from '@noocodex/dagonizer/types';

/** The scatter item value whose worker self-terminates mid-request. */
export const KILL_ITEM = 20;

/**
 * scatter-killer: same effect as scatter-counter (value += 1) for non-kill
 * items; for the kill item it terminates the worker thread WITHOUT sending a
 * result — the silent-death simulation. Reads the current item from metadata
 * via the node context's itemKey ('currentItem').
 */
const scatterKillerNode: NodeInterface<ConformanceState> = {
  'name': 'scatter-counter',
  'outputs': ['done'],
  async execute(state: ConformanceState): Promise<NodeOutputInterface<'done'>> {
    const current = state.getMetadata<number>('currentItem');
    if (current === KILL_ITEM) {
      // Silent death: terminate this worker thread mid-request. No result is
      // sent. The parent's exit listener is the only thing that unblocks the
      // pending request. Give the event loop nothing else to do first.
      process.exit(7);
    }
    state.value += 1;
    return { 'output': 'done' };
  },
};

/**
 * Build a bundle identical to the conformance bundle but with scatter-counter
 * replaced by scatter-killer. Same DAGs (law8 runner, scatter-item-body) and
 * the same restoreState/version so the parent and the worker agree on shapes.
 */
function buildKillBundle(): RegistryBundleInterface {
  const base = ConformanceRegistry.bundle();
  const nodes = base.bundle.nodes.filter((n) => n.name !== 'scatter-counter');
  nodes.push(scatterKillerNode as (typeof base.bundle.nodes)[number]);
  return {
    'bundle': {
      'nodes': nodes,
      'dags': base.bundle.dags,
    },
    'services': base.services,
    'registryVersion': base.registryVersion,
    'restoreState': base.restoreState,
  };
}

const registry: RegistryModuleInterface = {
  async createBundle(_servicesConfig: JsonObject): Promise<RegistryBundleInterface> {
    return buildKillBundle();
  },
};

export default registry;
