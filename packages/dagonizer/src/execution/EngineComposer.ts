import type { DagRegistrarSourceInterface } from '../dag/DagRegistrar.js';
import { DagRegistrar } from '../dag/DagRegistrar.js';
import type { DispatcherRelaySourceInterface } from '../observer/DispatcherHooks.js';

import { BodyExecutor } from './BodyExecutor.js';
import type { BodyRunPortInterface } from './BodyExecutor.js';
import { EmbeddedDagExecutor } from './EmbeddedDagExecutor.js';
import type { EmbeddedDagExecutorSourceType } from './EmbeddedDagExecutor.js';
import { Gather } from './Gather.js';
import type { GatherSourceInterface } from './Gather.js';
import { LeafExecutor } from './LeafExecutor.js';
import type { LeafExecutorSourceInterface } from './LeafExecutor.js';
import { NodeScheduler } from './NodeScheduler.js';
import type { NodeSchedulerSourceInterface } from './NodeScheduler.js';
import { PlacementDispatch } from './PlacementDispatch.js';
import type { ScatterDispatchSourceInterface } from './ScatterDispatch.js';
import { ScatterExecutor } from './ScatterExecutor.js';

/**
 * The composition host the engine modules wire against. Every narrow
 * source-port interface an engine module depends on is composed here into a
 * single host contract. `Dagonizer` constructs a private engine-host object
 * (a local class declared inside its own constructor, never exposed to
 * consumers) that satisfies it and passes that object — not itself — to
 * `EngineComposer.compose`. This keeps the ~20 relay/context/execution
 * methods and the four mutable registries (`dags`, `nodes`, `nodeIndex`,
 * `stateFactories`) these ports require off `Dagonizer`'s own public surface.
 *
 * Declared as an intersection rather than `interface … extends` because the
 * constituent ports declare the same collaborator (`nodes`, `dags`) at
 * different read variances — one as `Map`, another as `ReadonlyMap`. A class
 * with a `Map` field satisfies every port (which is why the engine host can
 * `implements` them all), but an `interface extends` would reject the
 * variance mismatch. The intersection resolves each shared member to the
 * narrower `Map & ReadonlyMap`, and the engine host's `Map` fields are
 * assignable to that intersection.
 *
 * `EngineComposer.compose` takes one value of this type and constructs the
 * whole engine module graph, so the explicit dependency ordering lives in one
 * place rather than being implied by constructor statement order on the root.
 */
export type EngineHostType =
  & DispatcherRelaySourceInterface
  & BodyRunPortInterface
  & GatherSourceInterface
  & LeafExecutorSourceInterface
  & EmbeddedDagExecutorSourceType
  & ScatterDispatchSourceInterface
  & NodeSchedulerSourceInterface
  & DagRegistrarSourceInterface;

/**
 * Immutable record of every engine module constructed for one dispatcher
 * instance. A data record (method-less), so it is a `type` ending in `Type`
 * per the canonical-naming rule. `EngineComposer.compose` returns it; the
 * composition root reads each field onto its own `this.X` slots in declaration
 * order, preserving V8 shape stability and every existing internal call site.
 */
export type EngineBundleType = {
  readonly bodyExecutor: BodyExecutor;
  readonly gather: Gather;
  readonly leafExecutor: LeafExecutor;
  readonly embeddedDagExecutor: EmbeddedDagExecutor;
  readonly scatterExecutor: ScatterExecutor;
  readonly placementDispatch: PlacementDispatch;
  readonly nodeScheduler: NodeScheduler;
  readonly dagRegistrar: DagRegistrar;
};

/**
 * Owns the engine module wiring graph.
 *
 * `compose` constructs the eight engine modules in their one valid dependency
 * order and returns them as an immutable `EngineBundleType`. The ordering is
 * load-bearing:
 *
 *   - `bodyExecutor` is built first; both `embeddedDagExecutor` and
 *     `scatterExecutor` take it as a collaborator.
 *   - `gather` is built before `scatterExecutor`, which takes it for the
 *     finalize-pass gather composition.
 *   - `leafExecutor`, `embeddedDagExecutor`, and `scatterExecutor` are all built
 *     before `placementDispatch`, which routes per-`@type` across the three.
 *
 * Keeping this graph in one static method makes the dependency edges explicit
 * and keeps the composition root's constructor a flat field-assignment list.
 */
export class EngineComposer {
  private constructor() { /* static class */ }

  static compose(
    host: EngineHostType,
  ): EngineBundleType {
    const bodyExecutor = new BodyExecutor(host);
    const gather = new Gather(host);
    const leafExecutor = new LeafExecutor(host);
    const embeddedDagExecutor = new EmbeddedDagExecutor(host, bodyExecutor);
    const scatterExecutor = new ScatterExecutor(host, bodyExecutor, gather);
    const placementDispatch = new PlacementDispatch(leafExecutor, embeddedDagExecutor, scatterExecutor);
    const nodeScheduler = new NodeScheduler(host, gather);
    const dagRegistrar = new DagRegistrar(host);
    return {
      bodyExecutor,
      gather,
      leafExecutor,
      embeddedDagExecutor,
      scatterExecutor,
      placementDispatch,
      nodeScheduler,
      dagRegistrar,
    };
  }
}
