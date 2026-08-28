import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DocPageRenderer } from '../src/lib/render-doc-page';

const docsRoot = fileURLToPath(new URL('../../docs/', import.meta.url));

const CANONICAL_ORDER = [
  'What It Is',
  'Diagrams, Examples, and Outputs',
  'How It Works',
  'Code Samples',
  'What It Lets You Do',
  'Details for Nerds',
  'Related Concepts'
];

const CANONICAL_ALIASES = new Map<string, string>([
  ['What It Is', 'What It Is'],
  ['Runtime Surface', 'What It Is'],
  ['Scatter-to-Gather Contract', 'What It Is'],
  ['Lifecycle Projection', 'What It Is'],
  ['CLI Host', 'What It Is'],
  ['Stream Producer Boundary', 'What It Is'],
  ['Checkpoint Model', 'What It Is'],
  ['State Model', 'What It Is'],
  ['ReAct Mapping', 'What It Is'],
  ['Rendering Surface', 'What It Is'],
  ['Dependency Model', 'What It Is'],
  ['Plugin Assembly', 'What It Is'],
  ['Observer Surface', 'What It Is'],
  ['Persistence Model', 'What It Is'],
  ['Cancellation Contract', 'What It Is'],
  ['Accessor Contract', 'What It Is'],
  ['Distribution Model', 'What It Is'],
  ['Batch Execution Model', 'What It Is'],
  ['Document Model', 'What It Is'],
  ['Parking Model', 'What It Is'],
  ['Tuning Surface', 'What It Is'],
  ['Reservoir Model', 'What It Is'],
  ['Runtime Utilities', 'What It Is'],
  ['Gather and Reducer Surface', 'What It Is'],
  ['Host Adapter Surface', 'What It Is'],
  ['Shared Store Surface', 'What It Is'],
  ['Execution Handle', 'What It Is'],
  ['Checkpoint Surface', 'What It Is'],
  ['Integration Surface', 'What It Is'],
  ['Placement Surface', 'What It Is'],
  ['Adapter Surface', 'What It Is'],
  ['Handoff Surface', 'What It Is'],
  ['Container Surface', 'What It Is'],
  ['Lifecycle Surface', 'What It Is'],
  ['Validation Surface', 'What It Is'],
  ['Error Surface', 'What It Is'],
  ['Deterministic Runtime Surface', 'What It Is'],
  ['Renderer Surface', 'What It Is'],
  ['Dispatcher Surface', 'What It Is'],
  ['Schema Surface', 'What It Is'],
  ['Public API Surface', 'What It Is'],
  ['Triple-term Surface', 'What It Is'],
  ['Runtime Constant Surface', 'What It Is'],
  ['Accessor Replacement Surface', 'What It Is'],
  ['Remote Store Surface', 'What It Is'],
  ['Registry Identity Surface', 'What It Is'],
  ['Node Base-class Surface', 'What It Is'],
  ['Deterministic Time Surface', 'What It Is'],
  ['Tool Fan-out Surface', 'What It Is'],
  ['Gather Strategy Surface', 'What It Is'],
  ['Incremental Fold Surface', 'What It Is'],
  ['Durable Scatter Resume', 'What It Is'],
  ['Async Source Surface', 'What It Is'],
  ['Execution Stream Surface', 'What It Is'],
  ['Producer Feed Surface', 'What It Is'],
  ['Durable Cursor Surface', 'What It Is'],
  ['Canonical DAG Surface', 'What It Is'],
  ['Builder Authoring Surface', 'What It Is'],
  ['Ingest Validation Surface', 'What It Is'],
  ['Retry Surface', 'What It Is'],
  ['Phase Placement Surface', 'What It Is'],
  ['Producer Bridge Surface', 'What It Is'],
  ['Conversation Workflow Surface', 'What It Is'],
  ['Lifecycle Hook Surface', 'What It Is'],
  ['Retry Timing Surface', 'What It Is'],
  ['Model Provider Surface', 'What It Is'],
  ['Embedding Provider Surface', 'What It Is'],
  ['Tool Dispatch Surface', 'What It Is'],
  ['Agent Loop Surface', 'What It Is'],
  ['Park-and-Resume Surface', 'What It Is'],
  ['Plugin DAG Surface', 'What It Is'],
  ['Resume Boundary', 'What It Is'],
  ['Terminal Outcome Surface', 'What It Is'],
  ['Shared Memory Surface', 'What It Is'],
  ['Operator Handoff Surface', 'What It Is'],
  ['Container Role Surface', 'What It Is'],
  ['Role-bound Execution Surface', 'What It Is'],
  ['Store-backed State Surface', 'What It Is'],
  ['Diagrams, Examples, and Outputs', 'Diagrams, Examples, and Outputs'],
  ['Flow and Runtime Behavior', 'Diagrams, Examples, and Outputs'],
  ['Registered Flow', 'Diagrams, Examples, and Outputs'],
  ['Examples and References', 'Diagrams, Examples, and Outputs'],
  ['Registered Flows', 'Diagrams, Examples, and Outputs'],
  ['Rendered Outputs', 'Diagrams, Examples, and Outputs'],
  ['Observable Flow', 'Diagrams, Examples, and Outputs'],
  ['Persistence Lifecycle', 'Diagrams, Examples, and Outputs'],
  ['Abort and Deadline Flow', 'Diagrams, Examples, and Outputs'],
  ['Path Resolution Surface', 'Diagrams, Examples, and Outputs'],
  ['Worker and Handoff Flows', 'Diagrams, Examples, and Outputs'],
  ['Reservoir-backed Example Flow', 'Diagrams, Examples, and Outputs'],
  ['Loaded Document and Round-Trip', 'Diagrams, Examples, and Outputs'],
  ['Escalation Flow', 'Diagrams, Examples, and Outputs'],
  ['Runtime Control Points', 'Diagrams, Examples, and Outputs'],
  ['Buffered Scatter Flow', 'Diagrams, Examples, and Outputs'],
  ['References and Test Surfaces', 'Diagrams, Examples, and Outputs'],
  ['Flow and Registry References', 'Diagrams, Examples, and Outputs'],
  ['Trigger and Runner References', 'Diagrams, Examples, and Outputs'],
  ['Store and Checkpoint References', 'Diagrams, Examples, and Outputs'],
  ['Adjacent Runtime References', 'Diagrams, Examples, and Outputs'],
  ['Resume and Snapshot References', 'Diagrams, Examples, and Outputs'],
  ['Default Implementations and Extensions', 'Diagrams, Examples, and Outputs'],
  ['Schema and Contract References', 'Diagrams, Examples, and Outputs'],
  ['Application and Contract References', 'Diagrams, Examples, and Outputs'],
  ['Transport and Deployment References', 'Diagrams, Examples, and Outputs'],
  ['Worker and Role References', 'Diagrams, Examples, and Outputs'],
  ['Execution and Hook References', 'Diagrams, Examples, and Outputs'],
  ['Schema and Error References', 'Diagrams, Examples, and Outputs'],
  ['Validation and Runtime References', 'Diagrams, Examples, and Outputs'],
  ['Runtime Provider References', 'Diagrams, Examples, and Outputs'],
  ['Rendering References', 'Diagrams, Examples, and Outputs'],
  ['Registry and Runtime References', 'Diagrams, Examples, and Outputs'],
  ['Schema and Validation References', 'Diagrams, Examples, and Outputs'],
  ['Entry-point References', 'Diagrams, Examples, and Outputs'],
  ['Probe and Encoding References', 'Diagrams, Examples, and Outputs'],
  ['CLI Output and Guard Coverage', 'Diagrams, Examples, and Outputs'],
  ['CLI Wiring and Path Resolution', 'Diagrams, Examples, and Outputs'],
  ['CLI Lifecycle and Lease Flow', 'Diagrams, Examples, and Outputs'],
  ['Collision and Prefix Cases', 'Diagrams, Examples, and Outputs'],
  ['Minimal Routing Flow', 'Diagrams, Examples, and Outputs'],
  ['Timeout Flow', 'Diagrams, Examples, and Outputs'],
  ['Scout Flow and Container Path', 'Diagrams, Examples, and Outputs'],
  ['Cartographer Gather Flows', 'Diagrams, Examples, and Outputs'],
  ['Incremental Gather Flow', 'Diagrams, Examples, and Outputs'],
  ['Checkpointed Scatter Flow', 'Diagrams, Examples, and Outputs'],
  ['Producer-feed Scatter Flow', 'Diagrams, Examples, and Outputs'],
  ['Caller Observation Flow', 'Diagrams, Examples, and Outputs'],
  ['Feed-in Topology', 'Diagrams, Examples, and Outputs'],
  ['Resumable Stream Flow', 'Diagrams, Examples, and Outputs'],
  ['Canonical Document and Runtime', 'Diagrams, Examples, and Outputs'],
  ['Typed Routing and Placement API', 'Diagrams, Examples, and Outputs'],
  ['Loaded Document and Validation Path', 'Diagrams, Examples, and Outputs'],
  ['Retry Loop and Policy Flow', 'Diagrams, Examples, and Outputs'],
  ['Phase Ordering Flow', 'Diagrams, Examples, and Outputs'],
  ['Channel and Producer Flows', 'Diagrams, Examples, and Outputs'],
  ['Conversation Topologies', 'Diagrams, Examples, and Outputs'],
  ['Observable Support Flow', 'Diagrams, Examples, and Outputs'],
  ['Retry and Salvage Flow', 'Diagrams, Examples, and Outputs'],
  ['Adapter-backed Agent Flow', 'Diagrams, Examples, and Outputs'],
  ['Semantic Recall Flow', 'Diagrams, Examples, and Outputs'],
  ['Model-to-Tool Flow', 'Diagrams, Examples, and Outputs'],
  ['Registered Agent Topology', 'Diagrams, Examples, and Outputs'],
  ['Parked Support Flow', 'Diagrams, Examples, and Outputs'],
  ['Plugin-backed Ingest Flow', 'Diagrams, Examples, and Outputs'],
  ['Checkpoint Lifecycle', 'Diagrams, Examples, and Outputs'],
  ['Completed and Failed Endpoints', 'Diagrams, Examples, and Outputs'],
  ['Store-backed Archivist Flow', 'Diagrams, Examples, and Outputs'],
  ['Checkpointed Handoff Flow', 'Diagrams, Examples, and Outputs'],
  ['Worker-backed Scatter Flow', 'Diagrams, Examples, and Outputs'],
  ['Multi-role Worker Topology', 'Diagrams, Examples, and Outputs'],
  ['Shared Store and Checkpoint Flow', 'Diagrams, Examples, and Outputs'],
  ['How It Works', 'How It Works'],
  ['Host Wiring', 'How It Works'],
  ['Gather Semantics', 'How It Works'],
  ['Projection Boundary', 'How It Works'],
  ['Trigger and Projection Boundary', 'How It Works'],
  ['Inner-to-Outer Stream Wiring', 'How It Works'],
  ['Persistence Contract', 'How It Works'],
  ['Graph-backed Access', 'How It Works'],
  ['Streaming and Recall', 'How It Works'],
  ['Renderer Contracts', 'How It Works'],
  ['Injection Contract', 'How It Works'],
  ['Registration Contract', 'How It Works'],
  ['Observation Contract', 'How It Works'],
  ['Store Contract', 'How It Works'],
  ['Signal Propagation', 'How It Works'],
  ['Read/Write Contract', 'How It Works'],
  ['Container and Channel Contract', 'How It Works'],
  ['Work-set Scheduler', 'How It Works'],
  ['Serialization Contract', 'How It Works'],
  ['Park and Resume Contract', 'How It Works'],
  ['Boundary-level Controls', 'How It Works'],
  ['Release Contract', 'How It Works'],
  ['Provider and Policy Model', 'How It Works'],
  ['Strategy Resolution Model', 'How It Works'],
  ['Trigger Loop Contract', 'How It Works'],
  ['Snapshot and Mutation Contract', 'How It Works'],
  ['Consumption Model', 'How It Works'],
  ['Capture and Restore Contract', 'How It Works'],
  ['Binding Model', 'How It Works'],
  ['Placement Model', 'How It Works'],
  ['Provider Abstraction Model', 'How It Works'],
  ['Publish Contract', 'How It Works'],
  ['Isolate Execution Model', 'How It Works'],
  ['Transition Model', 'How It Works'],
  ['Ingest Boundary Model', 'How It Works'],
  ['Error Model', 'How It Works'],
  ['Virtual Time Model', 'How It Works'],
  ['Renderer Model', 'How It Works'],
  ['Registration and Execution Model', 'How It Works'],
  ['Schema Derivation Model', 'How It Works'],
  ['Export Boundary Model', 'How It Works'],
  ['Basic Encoding Model', 'How It Works'],
  ['Value-and-Type Contract', 'How It Works'],
  ['Accessor Delegation Model', 'How It Works'],
  ['Remote Store Contract', 'How It Works'],
  ['Prefix Expansion Model', 'How It Works'],
  ['Declared-output Model', 'How It Works'],
  ['Virtual Scheduler Model', 'How It Works'],
  ['Scatter Body and Gather Model', 'How It Works'],
  ['Merge and Reducer Model', 'How It Works'],
  ['Reduce-versus-Finalize Model', 'How It Works'],
  ['Inbox and Ack Model', 'How It Works'],
  ['Pull-backpressure Model', 'How It Works'],
  ['Execution Wrapper Model', 'How It Works'],
  ['Feed DAG and Intake Model', 'How It Works'],
  ['Cursor and Replay Model', 'How It Works'],
  ['Authoring Convergence Model', 'How It Works'],
  ['Builder Emission Model', 'How It Works'],
  ['Schema Boundary Model', 'How It Works'],
  ['Flow-loop versus Policy Model', 'How It Works'],
  ['Pre/Post Execution Model', 'How It Works'],
  ['Push-to-Pull Bridge Model', 'How It Works'],
  ['Turn, Park, and Stream Model', 'How It Works'],
  ['Hook Projection Model', 'How It Works'],
  ['Topology-versus-Timing Model', 'How It Works'],
  ['Adapter Injection Model', 'How It Works'],
  ['Embedder Provisioning Model', 'How It Works'],
  ['Tool DAG Dispatch Model', 'How It Works'],
  ['Loop Assembly Model', 'How It Works'],
  ['Correlation and Resume Model', 'How It Works'],
  ['Plugin Registration Model', 'How It Works'],
  ['Capture and Restore Model', 'How It Works'],
  ['Outcome Propagation Model', 'How It Works'],
  ['Store Injection Model', 'How It Works'],
  ['Cross-actor Resume Model', 'How It Works'],
  ['Role Binding Model', 'How It Works'],
  ['Role-to-Backend Model', 'How It Works'],
  ['Store versus Mapping Model', 'How It Works'],
  ['Code Samples', 'Code Samples'],
  ['What It Lets You Do', 'What It Lets You Do'],
  ['Operational Uses', 'What It Lets You Do'],
  ['Usage', 'What It Lets You Do'],
  ['Deployment Uses', 'What It Lets You Do'],
  ['Details for Nerds', 'Details for Nerds'],
  ['Runtime Notes', 'Details for Nerds'],
  ['Related Concepts', 'Related Concepts']
]);

function canonicalHeading(heading: string): string | undefined {
  return CANONICAL_ALIASES.get(heading);
}

function indexOfAny(headings: readonly string[], variants: readonly string[]): number {
  return headings.findIndex((heading) => variants.includes(heading));
}

function collectH2s(html: string): readonly string[] {
  const matches = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)];
  return matches.map((match) => match[1]);
}

async function renderSlug(slug: string): Promise<{ readonly headings: readonly string[] }> {
  const source = await readFile(`${docsRoot}${slug}.md`, 'utf8');
  const title = DocPageRenderer.leadingTitle(source);
  const rendered = await DocPageRenderer.render(source, { title, slug });
  return { headings: collectH2s(rendered.html) };
}

test('guide/examples/reference pages render the 7 canonical sections in the one true order', async () => {
  const slugs = ['guide/authoring', 'examples/the-dispatcher', 'reference/dagonizer'];

  for (const slug of slugs) {
    const { headings } = await renderSlug(slug);
    const canonicalOnly = headings
      .map(canonicalHeading)
      .filter((heading): heading is string => heading !== undefined);
    assert.deepEqual(canonicalOnly, CANONICAL_ORDER, `unexpected section order for ${slug}`);
  }
});

test('non-canonical extra H2 sections stay anchored after their original preceding canonical section', async () => {
  const { headings: persistenceHeadings } = await renderSlug('guide/persistence');
  const detailsIndex = indexOfAny(persistenceHeadings, ['Details for Nerds', 'Runtime Notes']);
  const rdfIndex = persistenceHeadings.indexOf('RDF graph state');
  const relatedIndex = persistenceHeadings.indexOf('Related Concepts');
  assert.ok(detailsIndex >= 0 && rdfIndex === detailsIndex + 1 && relatedIndex === rdfIndex + 1);

  const { headings: archivistHeadings } = await renderSlug('examples/the-archivist');
  const whatItIsIndex = indexOfAny(archivistHeadings, ['What It Is', 'Runtime Surface']);
  const runnableIndex = indexOfAny(archivistHeadings, ['Runnable Example', 'Live Host']);
  const diagramsIndex = indexOfAny(archivistHeadings, ['Diagrams, Examples, and Outputs', 'Flow and Runtime Behavior']);
  assert.ok(whatItIsIndex >= 0 && runnableIndex === whatItIsIndex + 1 && diagramsIndex === runnableIndex + 1);
});

test('non-doc-contract routes are unaffected by section reordering', async () => {
  const source = await readFile(`${docsRoot}architecture.md`, 'utf8');
  const sourceH2Order = [...source.matchAll(/^##(?!#)\s+(.+)$/gm)].map((match) => match[1].trim());
  const title = DocPageRenderer.leadingTitle(source);
  const rendered = await DocPageRenderer.render(source, { title, slug: 'architecture' });
  assert.deepEqual(collectH2s(rendered.html), sourceH2Order);
});
