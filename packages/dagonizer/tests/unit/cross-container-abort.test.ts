/**
 * cross-container-abort.test.ts
 *
 * Coverage target: G5 — cross-container abort propagation e2e.
 *
 * Verifies that when the parent dispatcher aborts the AbortSignal for an
 * in-flight runDag() call on a LoopbackContainer (DagContainerBase subclass),
 * the abort message is forwarded over the LoopbackChannel to DagHost, which
 * fires its AbortController for the correlated execution. The in-flight
 * DAG (conformance Law 5 — the abort-sleeper) terminates promptly.
 *
 * This is an e2e test: parent AbortSignal → ChannelDispatch abort-forwarding
 * → LoopbackChannel → DagHost abort handling → execution cancellation.
 */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DagContainerBase } from '../../src/container/DagContainerBase.js';
import type { PoolEntry } from '../../src/container/DagContainerBase.js';
import { DagHost } from '../../src/container/DagHost.js';
import type { DagContainerInterface } from '../../src/contracts/DagContainerInterface.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { DispatcherBundle } from '../../src/Dagonizer.js';
import type { JsonObject } from '../../src/entities/json.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import {
  ConformanceRegistry,
  ConformanceState,
  CONFORMANCE_CONTAINER_ROLE,
  CONFORMANCE_REGISTRY_VERSION,
  CONFORMANCE_DAG,
} from '../../testing/ConformanceRegistry.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';

// ---------------------------------------------------------------------------
// Registry module URL
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const REGISTRY_MODULE_URL = resolve(PACKAGE_ROOT, 'dist-testing', 'ConformanceRegistry.js');

// ---------------------------------------------------------------------------
// AbortLoopbackContainer — LoopbackContainer variant for G5
// ---------------------------------------------------------------------------

interface AbortTestWorker {
  hostSide: MessageChannelInterface;
}

class AbortLoopbackContainer extends DagContainerBase<NodeStateInterface, AbortTestWorker> {
  constructor() {
    super({
      ...DagContainerBase.defaultOptions,
      'poolSize': 1,
      'init': {
        'registryModule': REGISTRY_MODULE_URL,
        'registryVersion': CONFORMANCE_REGISTRY_VERSION,
        'servicesConfig': {} as JsonObject,
      },
    });
  }

  protected override createEntry(): PoolEntry<AbortTestWorker> {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const host = new DagHost(hostSide);
    host.start();
    return { 'worker': { 'hostSide': hostSide }, 'channel': parentSide, 'initialized': false };
  }

  protected override attachDeathListeners(_entry: PoolEntry<AbortTestWorker>): void {
    // In-process — no death events.
  }

  protected override terminateWorker(worker: AbortTestWorker): void {
    try { worker.hostSide.close(); } catch { /* suppress */ }
  }

  protected override awaitWorkerExit(_worker: AbortTestWorker): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// G5 — cross-container abort propagation e2e
// ---------------------------------------------------------------------------

void describe('Cross-container abort propagation (G5)', () => {
  void it('aborting the parent signal cancels the in-flight DAG execution promptly', async () => {
    const container = new AbortLoopbackContainer();
    const bundle = ConformanceRegistry.bundle().bundle as unknown as DispatcherBundle<NodeStateInterface, undefined>;
    const containers: Readonly<Record<string, DagContainerInterface<NodeStateInterface>>> = {
      [CONFORMANCE_CONTAINER_ROLE]: container,
    };
    const dispatcher = new Dagonizer<NodeStateInterface, undefined>({ containers });
    dispatcher.registerBundle(bundle);

    // Dispatcher-level abort controller — connects to the runDag signal via
    // Dagonizer.execute(dag, state, { signal }) overload path.
    const controller = new AbortController();

    const state = new ConformanceState();

    // Law 5: the abort-sleeper node runs until its signal fires. The execution
    // is routed through AbortLoopbackContainer (cross-container boundary).
    const start = Date.now();
    const executionPromise = dispatcher.execute(CONFORMANCE_DAG.law5, state, {
      'signal': controller.signal,
    });

    // Give the sleeper node time to start inside DagHost.
    await new Promise<void>((r) => setTimeout(r, 50));

    // Abort — signal propagates: Dagonizer → ChannelDispatch → abort BridgeMessage
    // → LoopbackChannel → DagHost → AbortController for the execution.
    controller.abort();

    const result = await executionPromise;
    const elapsed = Date.now() - start;

    // The execution must complete (abort resolves, not hangs) within 2 s.
    assert.ok(elapsed < 2000,
      `abort must resolve the execution within 2s (cross-container); elapsed=${elapsed}ms`);

    // After abort the lifecycle is non-running (completed or failed).
    assert.notStrictEqual(result.state.lifecycle.kind, 'running',
      `lifecycle must not be 'running' after abort; got '${result.state.lifecycle.kind}'`);

    await container.destroy();
  });

  void it('abort before the execution starts still resolves cleanly', async () => {
    const container = new AbortLoopbackContainer();
    const bundle = ConformanceRegistry.bundle().bundle as unknown as DispatcherBundle<NodeStateInterface, undefined>;
    const containers: Readonly<Record<string, DagContainerInterface<NodeStateInterface>>> = {
      [CONFORMANCE_CONTAINER_ROLE]: container,
    };
    const dispatcher = new Dagonizer<NodeStateInterface, undefined>({ containers });
    dispatcher.registerBundle(bundle);

    const controller = new AbortController();
    controller.abort(); // abort before execute is called

    const state = new ConformanceState();

    // Should resolve immediately (no hang), even with a pre-aborted signal.
    await assert.doesNotReject(async () => {
      await dispatcher.execute(CONFORMANCE_DAG.law5, state, { 'signal': controller.signal });
    });

    await container.destroy();
  });
});
