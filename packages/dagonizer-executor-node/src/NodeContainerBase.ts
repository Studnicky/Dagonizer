/**
 * NodeContainerBase: shared abstract base for every Node.js `DagContainerBase`
 * backend (`ForkContainer`, `ClusterContainer`, `SpawnContainer`,
 * `WorkerThreadContainer`).
 *
 * The four Node containers all resolve their default pool size the same way —
 * probe the host with `NodeSystemInfo.recommendedWorkerCount`, clamped to a
 * maximum of eight workers — and all forward the same `registryModule`,
 * `registryVersion`, and `servicesConfig` into the `DagContainerBase` init
 * handshake. This base owns that resolution and the defaults spread; a concrete
 * container supplies only its transport-specific seams and its own entry URL.
 *
 * `NodeSystemInfo` is instantiated exactly once at module load and shared by
 * every container construction, so the host probe surface is never rebuilt
 * per-constructor.
 *
 * Subclass contract:
 *   - call `super(NodeContainerBase.resolveOptions(options))` as the first
 *     constructor statement.
 *   - implement the `DagContainerBase` abstract seams (`composeEntry`,
 *     `attachDeathListeners`, `terminateWorker`, `awaitWorkerExit`).
 *   - resolve the subclass-specific `entryUrl` after `super()` returns.
 */

import {
  DagContainerBase,
} from '@studnicky/dagonizer/container';
import type {
  DagContainerOptionsType,
} from '@studnicky/dagonizer/container';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';
import { RecommendedWorkerCountConfigDefault } from '@studnicky/dagonizer/entities';

import { NodeSystemInfo } from './NodeSystemInfo.js';

// ---------------------------------------------------------------------------
// NodeContainerBaseOptionsType: shared constructor input fields
// ---------------------------------------------------------------------------

/**
 * Constructor-input fields shared by every Node container. Each container's
 * own options interface `extends` this and adds only its transport extras.
 *
 *   registryModule   — URL string passed to DagHost init
 *   registryVersion  — version for the init ↔ ready handshake
 *   servicesConfig   — opaque JSON passed to instantiate (default: {})
 *   poolSize         — number of workers (default: recommended worker count)
 *   entryUrl         — override the default entry module URL (for tests)
 */
export type NodeContainerBaseOptionsType = {
  readonly registryModule: string;
  readonly registryVersion: string;
  readonly servicesConfig?: JsonObjectType;
  readonly poolSize?: number;
  readonly entryUrl?: URL;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Hard ceiling on the auto-resolved pool size, shared by every Node container. */
const MAXIMUM_WORKERS = 8;

/** Empty services config used when a container omits `servicesConfig`. */
const DEFAULT_SERVICES_CONFIG: JsonObjectType = {};

/**
 * Single host-probe instance shared by every container construction. Built once
 * at module load; never re-instantiated per constructor.
 */
const SYSTEM_INFO = new NodeSystemInfo();

// ---------------------------------------------------------------------------
// NodeContainerBaseType: class-shape type for NodeContainerBase
// ---------------------------------------------------------------------------

/**
 * Public face of `NodeContainerBase`. The base adds no new instance surface
 * beyond `DagContainerBase`; the shared behavior lives in the static
 * `resolveOptions` factory the subclass constructors call.
 */
export type NodeContainerBaseType<
  TWorker,
> = DagContainerBase<TWorker>;

// ---------------------------------------------------------------------------
// NodeContainerBase
// ---------------------------------------------------------------------------

export abstract class NodeContainerBase<TWorker>
  extends DagContainerBase<TWorker> {

  /**
   * Resolve a `NodeContainerBaseOptionsType` into the complete `DagContainerOptionsType`
   * the `DagContainerBase` constructor consumes. Fills the default pool size
   * from the shared `NodeSystemInfo` probe (clamped to `MAXIMUM_WORKERS`) and
   * the empty `servicesConfig` default, then layers the base defaults spread.
   *
   * Subclasses call this as the argument to `super(...)`.
   */
  protected static resolveOptions(options: NodeContainerBaseOptionsType): DagContainerOptionsType {
    const defaultPoolSize = SYSTEM_INFO.recommendedWorkerCount({
      ...RecommendedWorkerCountConfigDefault,
      'maximumWorkers': MAXIMUM_WORKERS,
    });
    return {
      ...DagContainerBase.defaultOptions,
      'poolSize': options.poolSize ?? defaultPoolSize,
      'init': {
        'registryModule': options.registryModule,
        'registryVersion': options.registryVersion,
        'servicesConfig': options.servicesConfig ?? DEFAULT_SERVICES_CONFIG,
      },
    };
  }
}
