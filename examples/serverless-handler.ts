/**
 * serverless-handler: runnable exercise of the envelope-in / envelope-out
 * serverless pattern with a REAL in-process queue channel.
 *
 * No cloud SDK and no network: InMemoryQueueChannel pushes envelopes into a
 * plain array that stands in for SQS / Pub/Sub. The handler restores state from
 * an inbound envelope, runs the settle DAG, and the bound egress channel
 * publishes the downstream envelope. Production swaps the array push for an SDK
 * call; the contract method and the handler shape are unchanged.
 *
 * Definitions (queue channel + handler + DAG): examples/dags/serverless-handler.ts
 *
 * Run: npx tsx examples/serverless-handler.ts
 */

import type { DAGHandoffType } from '@studnicky/dagonizer/entities';

import {
  InMemoryQueueChannel,
  REGISTRY_VERSION,
  SETTLE_DAG_IRI,
  ServerlessHandler,
} from './dags/serverless-handler.js';

process.stdout.write('\n=== serverless-handler: envelope-in / envelope-out over an in-memory queue ===\n\n');

// The downstream queue the egress channel publishes into.
const downstreamQueue: DAGHandoffType[] = [];
const egress = new InMemoryQueueChannel(downstreamQueue);

// An inbound envelope, as a queue trigger would deliver it.
const inbound: DAGHandoffType = {
  dagName: SETTLE_DAG_IRI,
  terminalName: 'done',
  terminalOutput: 'completed',
  registryVersion: REGISTRY_VERSION,
  correlationId: 'order-001',
  placementPath: [],
  stateSnapshot: { orderId: 'order-001', total: 4200, status: 'pending' },
};

process.stdout.write(`[inbound]  correlationId="${inbound.correlationId}" status="pending"\n`);

const settled = await ServerlessHandler.handle(inbound, egress);

process.stdout.write(`[handler]  orderId="${settled.orderId}" status="${settled.status}"\n`);
process.stdout.write(`[egress]   downstream queue depth=${String(downstreamQueue.length)}\n`);

const next = downstreamQueue[0];
if (next !== undefined) {
  process.stdout.write(`[egress]   next envelope: dagName="${next.dagName}" terminal="${next.terminalName}" correlationId="${next.correlationId}"\n\n`);
}

if (settled.status !== 'settled') {
  throw new Error(`Expected status='settled', got '${settled.status}'`);
}
if (downstreamQueue.length !== 1) {
  throw new Error(`Expected one downstream envelope, got ${String(downstreamQueue.length)}`);
}

process.stdout.write('Assertions passed.\n');
process.stdout.write('Lesson: a serverless handler is a plain Dagonizer instance — restore the\n');
process.stdout.write('        envelope, execute, let bound egress channels publish the next one.\n');
