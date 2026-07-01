/**
 * 32-dispatcher: HITL park-and-correlate with a trolley switch + real LLM.
 *
 * Demonstrates the Noocodex Support dispatcher — a customer support
 * warm-handoff demo that shows the HITL park-and-correlate primitive
 * with a trolley switch.
 *
 * Domain: Noocodex — fictional bookstore.
 *   Routine queries (order status, store hours, book availability) → AI.
 *   Escalation triggers (refund, billing, etc.) → auto-escalate to operator.
 *   Trolley switch: humanMode = true → ALL messages go to operator.
 *
 * LLM resolved via LlmAdapterCascadeBuilder (same pattern as runArchivist.ts):
 *   Ollama (localhost) → API key providers (GEMINI_API_KEY, GROQ_API_KEY, etc.)
 *   Set OLLAMA_BASE_URL to override the default 127.0.0.1:11434.
 *
 * Three scenarios:
 *   1. Routine query — AI composes and sends without parking.
 *   2. Escalated query — parks, operator responds, checkpoint/resume.
 *   3. Trolley switch — humanMode = true forces operator even for "store hours?".
 *
 * DAG definition: examples/the-dispatcher/dag.ts
 *
 * Run: npx tsx examples/32-dispatcher.ts
 */

import {
  Checkpoint,
  CheckpointRestoreAdapter,
  Dagonizer,
} from '@studnicky/dagonizer';

import {
  LlmAdapterCascadeBuilder,
  type CatalogueEntryType,
} from '@studnicky/dagonizer/adapter';

import { OllamaApiAdapter }  from '@studnicky/dagonizer-adapter-ollama';

import { DispatcherState }         from './the-dispatcher/DispatcherState.js';
import { DispatcherBundleFactory } from './the-dispatcher/dag.js';
import { DispatcherLlmClient }     from './the-dispatcher/providers/DispatcherLlmClient.js';
import type { DispatcherServices } from './the-dispatcher/services.js';

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

class Env {
  static get(key: string): string {
    if (typeof process === 'undefined') return '';
    const raw = process.env[key];
    return typeof raw === 'string' ? raw : '';
  }
}

const OLLAMA_BASE_URL = Env.get('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434';

// ---------------------------------------------------------------------------
// Adapter cascade: local-first, falls back to keyed providers.
// ---------------------------------------------------------------------------

const catalogue: CatalogueEntryType[] = [];

const ollamaAdapter = new OllamaApiAdapter({ 'baseUrl': OLLAMA_BASE_URL });
const resolvedOllamaModel = await ollamaAdapter.selectChatModel({
  ...(Env.get('OLLAMA_MODEL').length > 0 ? { 'preferred': Env.get('OLLAMA_MODEL') } : {}),
});
if (resolvedOllamaModel !== null) {
  catalogue.push({
    'descriptor': {
      'provider':     'ollama',
      'model':        resolvedOllamaModel,
      'capabilities': { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false },
    },
    'factory': () => ollamaAdapter,
  });
}

const cascade = LlmAdapterCascadeBuilder.build(catalogue);
const adapter = await cascade.select();

process.stdout.write(`\nLLM backend: ${adapter.id} (${adapter.displayName})\n`);

// ---------------------------------------------------------------------------
// Services: wire the LLM adapter into the Dispatcher service bag. This CLI demo
// runs without an on-device embedder, so `intent` is null — ClassifyMessageNode
// classifies via the LLM. The browser runner provisions an embedder and passes
// a DispatcherIntentClassifier here instead.
// ---------------------------------------------------------------------------

const services: DispatcherServices = { 'llm': new DispatcherLlmClient(adapter), 'intent': null };

// ---------------------------------------------------------------------------
// Setup: one dispatcher instance, shared across all three scenarios.
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<DispatcherState>();
dispatcher.registerBundle(DispatcherBundleFactory.create(services));

// ---------------------------------------------------------------------------
// Scenario 1: Routine query — AI handles end-to-end
// ---------------------------------------------------------------------------

process.stdout.write('\n=== The Dispatcher: Noocodex Support ===\n\n');
process.stdout.write('--- Scenario 1: Routine query (AI handles) ---\n');

const routineState = new DispatcherState();
routineState.message = 'What are your store hours?';

const routineResult = await dispatcher.execute('support-dispatcher', routineState);

process.stdout.write(`  lifecycle:   ${routineResult.state.lifecycle.variant}\n`);
process.stdout.write(`  parked:      ${routineResult.parked}\n`);
process.stdout.write(`  conversation:\n`);
for (const turn of routineResult.state.conversation) {
  process.stdout.write(`    [${turn.role}] ${turn.text}\n`);
}

// ---------------------------------------------------------------------------
// Scenario 2: Escalated query — parks, operator responds, checkpoint/resume
// ---------------------------------------------------------------------------

process.stdout.write('\n--- Scenario 2: Escalation → park → operator reply → resume ---\n');

const escalatedState = new DispatcherState();
escalatedState.message = 'I need a refund for my last order';

// Step 2a: Initial execute — should park (escalation triggered)
const parkedResult = await dispatcher.execute('support-dispatcher', escalatedState);

process.stdout.write(`  Step 2a — Initial run:\n`);
process.stdout.write(`    lifecycle:            ${parkedResult.state.lifecycle.variant}\n`);
process.stdout.write(`    escalationReason:     ${parkedResult.state.escalationReason}\n`);
process.stdout.write(`    parked.correlationKey: ${parkedResult.parked?.correlationKey}\n`);
process.stdout.write(`    parked.cursor:         ${parkedResult.parked?.cursor}\n`);

if (parkedResult.parked === null) {
  throw new Error('Expected result.parked to be non-null for escalated message');
}
if (parkedResult.state.lifecycle.variant !== 'awaiting-input') {
  throw new Error(`Expected lifecycle awaiting-input, got ${parkedResult.state.lifecycle.variant}`);
}

// Step 2b: Capture checkpoint
const ckpt = await Checkpoint.capture('support-dispatcher', parkedResult);
const persisted = ckpt.toJson();

process.stdout.write(`\n  Step 2b — Checkpoint captured:\n`);
process.stdout.write(`    cursor: ${ckpt.data.cursor}\n`);

// Step 2c: Human operator provides response (out-of-band in real apps)
const operatorResponse = "I've processed your refund. It will appear in 3–5 business days. We apologize for any inconvenience!";
process.stdout.write(`\n  Step 2c — Operator responds: "${operatorResponse}"\n`);

// Step 2d: Restore checkpoint, inject operator response, resume
const recalled = Checkpoint.load(JSON.parse(persisted));
const { state: resumedState, dagName, cursor } = recalled.restoreState(
  CheckpointRestoreAdapter.wrap((snap) => DispatcherState.restore(snap)),
);

// Inject operator response before resume — ParkForOperatorNode checks this
resumedState.response = operatorResponse;

process.stdout.write(`\n  Step 2d — Resume from cursor '${cursor}':\n`);
const finalResult = await dispatcher.resume(dagName, resumedState, cursor);

process.stdout.write(`    lifecycle:   ${finalResult.state.lifecycle.variant}\n`);
process.stdout.write(`    parked:      ${finalResult.parked}\n`);
process.stdout.write(`    conversation:\n`);
for (const turn of finalResult.state.conversation) {
  process.stdout.write(`      [${turn.role}] ${turn.text}\n`);
}

// ---------------------------------------------------------------------------
// Scenario 3: Trolley switch — humanMode = true forces all to operator
// ---------------------------------------------------------------------------

process.stdout.write('\n--- Scenario 3: Trolley switch (humanMode = true) ---\n');

// Even a benign "store hours" query must go to operator when switch is active.
const trolleyState = new DispatcherState();
trolleyState.message = 'What are your store hours?';
trolleyState.humanMode = true;

const trolleyParked = await dispatcher.execute('support-dispatcher', trolleyState);

process.stdout.write(`  Initial run (humanMode=true):\n`);
process.stdout.write(`    lifecycle:            ${trolleyParked.state.lifecycle.variant}\n`);
process.stdout.write(`    escalationReason:     ${trolleyParked.state.escalationReason}\n`);
process.stdout.write(`    parked.correlationKey: ${trolleyParked.parked?.correlationKey}\n`);

if (trolleyParked.parked === null) {
  throw new Error('Expected trolley switch to park even a routine message');
}

// Resume with operator response
const trolleyCkpt = await Checkpoint.capture('support-dispatcher', trolleyParked);
const trolleyRecalled = Checkpoint.load(JSON.parse(trolleyCkpt.toJson()));
const { state: trolleyResumedState, dagName: trolleyDagName, cursor: trolleyCursor } =
  trolleyRecalled.restoreState(
    CheckpointRestoreAdapter.wrap((snap) => DispatcherState.restore(snap)),
  );

trolleyResumedState.response = "We're open Monday–Friday 9am–6pm and Saturday 10am–4pm. [Routed by operator per human mode]";

const trolleyFinal = await dispatcher.resume(trolleyDagName, trolleyResumedState, trolleyCursor);

process.stdout.write(`\n  Resume (operator handled):\n`);
process.stdout.write(`    lifecycle:   ${trolleyFinal.state.lifecycle.variant}\n`);
process.stdout.write(`    conversation:\n`);
for (const turn of trolleyFinal.state.conversation) {
  process.stdout.write(`      [${turn.role}] ${turn.text}\n`);
}

process.stdout.write(`\nLesson: park-and-correlate suspends execution without blocking the engine.\n`);
process.stdout.write(`        The trolley switch (humanMode) overrides AI routing for all messages.\n`);
process.stdout.write(`        Cursor + correlationKey persist the position; resume() re-enters cleanly.\n`);
