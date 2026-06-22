/**
 * 33-plugin: plugin loader + multi-observer mux.
 *
 * Demonstrates two independent features:
 *
 * 1. Plugin loader — a `NormalizePlugin` implements `PluginInterface` and
 *    self-registers its nodes and DAG via `registerPlugin()`. The consumer
 *    never calls `registerNode` / `registerDAG` directly; the plugin does it
 *    through the narrow `PluginReceiverType` seam.
 *
 * 2. Multi-observer mux — the `observers` option on `DagonizerOptionsType`
 *    accepts an array of `DispatcherObserverType` records. Each observer's
 *    callbacks mux into the corresponding lifecycle hook after any subclass
 *    override. This is the alternative to subclassing for callers that rebuild
 *    the dispatcher per turn (e.g. serverless or per-request dispatchers).
 *
 * DAG definitions (state, nodes, DAG, plugin): examples/dags/33-plugin.ts
 *
 * Run: npx tsx examples/33-plugin.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import type { DispatcherObserverType } from '@studnicky/dagonizer';

import { NormalizePlugin, PipelineState, parentDag } from './dags/33-plugin.js';

// ---------------------------------------------------------------------------
// Observer records: console logger and metric counter, composed via observers[]
// ---------------------------------------------------------------------------

// #region observers-option
const log: string[] = [];

const logObserver: DispatcherObserverType = {
  onFlowStart:  (dagName)         => { log.push(`[log]    flowStart  dag=${dagName}`); },
  onFlowEnd:    (dagName, _, res) => { log.push(`[log]    flowEnd    dag=${dagName} outcome=${res.terminalOutcome ?? 'none'}`); },
  onNodeStart:  (name)            => { log.push(`[log]    nodeStart  ${name}`); },
  onNodeEnd:    (name, output)    => { log.push(`[log]    nodeEnd    ${name} -> ${output ?? '(terminal)'}`); },
};

const metrics = { nodeStart: 0, nodeEnd: 0 };
const metricsObserver: DispatcherObserverType = {
  onNodeStart: () => { metrics.nodeStart++; },
  onNodeEnd:   () => { metrics.nodeEnd++; },
};
// #endregion observers-option

// ---------------------------------------------------------------------------
// Dispatcher: constructed with two muxed observers — no subclassing required
// ---------------------------------------------------------------------------

// #region dispatcher
const dispatcher = new Dagonizer<PipelineState>({
  observers: [logObserver, metricsObserver],
});
// #endregion dispatcher

// ---------------------------------------------------------------------------
// Plugin registration: one call installs all nodes + DAGs the plugin owns
// ---------------------------------------------------------------------------

// #region plugin-registration
dispatcher.registerPlugin(new NormalizePlugin());
dispatcher.registerDAG(parentDag);
// #endregion plugin-registration

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

const state = new PipelineState();
state.phrase = '  Hello, World! This is a somewhat long phrase.  ';

const result = await dispatcher.execute('pipeline', state);

console.log('normalized:', state.normalized);
console.log('status:    ', state.status);
console.log('outcome:   ', result.terminalOutcome);
console.log('');
console.log('log:');
for (const line of log) {
  console.log(' ', line);
}
console.log('');
console.log('metrics:   nodeStart=%d  nodeEnd=%d', metrics.nodeStart, metrics.nodeEnd);

if (result.terminalOutcome !== 'completed') {
  throw new Error(`Expected completed, got ${String(result.terminalOutcome)}`);
}
if (state.normalized !== 'hello, world! this is a somewhat long phrase.') {
  throw new Error(`Unexpected normalized value: ${state.normalized}`);
}
if (state.status !== 'long') {
  throw new Error(`Unexpected status: ${state.status}`);
}
if (metrics.nodeStart < 2 || metrics.nodeEnd < 2) {
  throw new Error(`Expected at least 2 node events, got nodeStart=${metrics.nodeStart} nodeEnd=${metrics.nodeEnd}`);
}

console.log('\nAll assertions passed.');
