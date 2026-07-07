---
title: 'Adapters'
description: 'LLM adapter reference for buffered chat, streamed token chunks, routed sinks, provider capability flags, cascades, and package export paths.'
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`LlmAdapterInterface`, `LlmClientInterface`, and every other adapter contract'
  - text: 'Guide: ReAct agent'
    link: '../guide/react-agent'
    description: 'live token streaming with `CallModelNode { sink }`, routing concurrent runs'
  - text: 'Example 24: LLM Adapter'
    link: '../examples/24-llm-adapter'
    description: 'registry, cascade, and the buffered `chat()` call in a DAG node'
  - text: 'Example: ReAct agent memory'
    link: '../examples/react-agent-memory'
    description: 'working example streaming live tokens through a shared sink'
---

# Adapters

## What It Is

Adapters put provider-specific LLM transports behind the shared `LlmAdapterInterface`. The same DAG node can call Anthropic, Gemini, Ollama, WebLLM, or an OpenAI-compatible backend without depending on a provider SDK.

Use this page when choosing an adapter, implementing a provider package, streaming token chunks, routing concurrent model output, or composing a cascade across multiple backends.

## How It Works

`chat()` is the buffered call. `chatStream()` emits chunks into a sink and still resolves to the same final response shape. Registries select adapters by descriptor and capability; cascades try multiple registered adapters in order.

Provider packages extend `BaseAdapter`, implement `performChat`, and optionally override `performChatStream` for real per-token streaming. Pattern nodes and agent loops depend on the contract, not on provider packages.

## Diagrams, Examples, and Outputs

Adapters show up in the ReAct and LLM examples rather than as standalone DAG shapes. These pages connect the contract to runnable behavior:

- [Reference: Contracts](./contracts) - `LlmAdapterInterface`, `LlmClientInterface`, and every other adapter contract
- [Guide: ReAct agent](../guide/react-agent) - live token streaming with `CallModelNode { sink }`, routing concurrent runs
- [Example 24: LLM Adapter](../examples/24-llm-adapter) - registry, cascade, and the buffered `chat()` call in a DAG node
- [Example: ReAct agent memory](../examples/react-agent-memory) - working example streaming live tokens through a shared sink

## What It Lets You Do

The adapters reference lets applications pick, implement, or compose LLM provider backends behind the shared `LlmAdapterInterface`.

`@studnicky/dagonizer/adapter`

An adapter is a port/adapter plugin that wires one LLM provider's transport
(HTTP, an in-browser API, a local engine) behind the single `LlmAdapterInterface`
contract. The engine, the agent pattern-tier nodes (`CallModelNode` and friends),
and the registry/cascade selection machinery all depend only on this interface —
never on a provider SDK. Provider packages (`@studnicky/dagonizer-adapter-anthropic`,
`-gemini-api`, `-gemini-nano`, `-ollama`, `-web-llm`) each extend `BaseAdapter`,
implement one abstract method (`performChat`), and optionally override one more
(`performChatStream`) to unlock real per-token streaming.

## Code Samples

The code below covers adapter base classes, registries, cascades, streaming chunks, routed sinks, SSE parsing, provider capabilities, and export paths.

### Import

```ts twoslash
import {
  BaseAdapter,
  LlmAdapterCascade,
  LlmAdapterRegistry,
  RoutingStreamSink,
  SseLineParser,
  ChatStreamChunk,
} from '@studnicky/dagonizer/adapter';
import type {
  AdapterCapabilitiesType,
  BaseAdapterOptionsType,
  ChatRequestType,
  ChatResponseType,
  ChatStreamChunkType,
  LlmAdapterInterface,
  RoutedChatStreamChunkType,
} from '@studnicky/dagonizer/adapter';
import type { StreamSinkInterface } from '@studnicky/dagonizer/contracts';
```

---

### `LlmAdapterInterface`

The contract every adapter implements — see [Reference: Contracts](./contracts#llmadapterinterface-llmclientinterface)
for the full interface listing. Two call shapes:

- **`chat(request)`** — buffered. Resolves once with the complete `ChatResponseType`.
- **`chatStream(request, sink)`** — resolves with the same `ChatResponseType`, and
  additionally pushes `ChatStreamChunkType` (`{ delta }`) values to `sink` as the
  response is produced. The sink is a pure observation channel: the returned
  response is authoritative regardless of whether anything is listening on `sink`.

Both calls are abort+timeout bounded by the adapter's configured `timeoutMs`
(default `60_000`, from `BaseAdapterOptionsType`). `chat()` is retried by the
adapter's `RetryPolicy` on retryable classifications (`NETWORK`, `TIMEOUT`,
`QUOTA_EXHAUSTED`); `chatStream()` is single-attempt — retrying a
partially-emitted stream would re-push deltas already delivered to the sink,
so a mid-stream failure surfaces to the caller instead of silently replaying.

Lifecycle rounds out the contract: `connect()`/`disconnect()` bring up and tear
down per-session state (a model download, a websocket handshake — most
adapters no-op), and `probe()` is a fast, non-throwing availability check a
cascade uses to skip an adapter that cannot currently serve a request.

### `BaseAdapter`

`BaseAdapter` is the abstract base every concrete adapter extends. It owns:

- **`chat()`** — wraps the abstract `performChat(request)` in the shared
  abort+timeout race (`withDeadline`) and the retry/classification envelope.
- **`chatStream()`** — wraps the (overridable) `performChatStream(request, sink)`
  in the same abort+timeout race, without the retry wrapper.
- **`performChatStream` default (buffered)** — calls `this.chat()` and pushes
  exactly one chunk carrying the complete response text (empty string for a
  pure tool-call response). An adapter that never overrides this method still
  satisfies the full streaming contract; it just never emits more than one
  chunk.
- **`pushChunk(sink, chunk)`** — pushes one chunk and swallows a rejection; a
  dead or misbehaving sink must never fail an otherwise-valid generation. A
  healthy sink's back-pressure (an awaited, slow-resolving `push()`) is still
  honored — only a *rejection* is swallowed.
- **`systemPrompt`** — an application-supplied default system message injected as
  the leading turn of any request that carries none of its own. Never
  overrides an explicit system message and never produces a second one.
- **`timeoutMs`** — the per-request hard abort+timeout ceiling (`60_000` ms
  default). An expired deadline classifies as `TIMEOUT`, which a cascade
  treats as retryable-elsewhere: it falls through to the next preference
  instead of hanging the whole call.
- **`circuitBreaker`** — optional substrate `CircuitBreaker` instance wrapping
  the whole logical `chat()` call. An open circuit rejects before retry or rate
  limiting.
- **`tokenBucket`** — optional substrate `TokenBucket` instance gating the
  logical `chat()` call before the retry loop, so retries do not multiply quota
  consumption.
- **`timing`** — optional substrate `Timing` sink receiving `adapter.chat.start`,
  `adapter.chat.complete`, `adapter.chat.error`, and matching
  `adapter.chatStream.*` events for logical provider calls.

See [Execution tuning](/guide/execution-tuning) for when to combine adapter
timeouts, retries, token buckets, circuit breakers, timing, and outer retry
policies.

```ts twoslash
import { BaseAdapter } from '@studnicky/dagonizer/adapter';
import type { ChatRequestType, ChatResponseType } from '@studnicky/dagonizer/adapter';
// ---cut---
class MyAdapter extends BaseAdapter {
  protected async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    // call the provider, decode its response into ChatResponseType
    throw new Error('not implemented in this snippet');
  }
  // performChatStream is optional — BaseAdapter's buffered default applies
  // until this is overridden with real per-token streaming.
}
```

### How each adapter streams

Every adapter falls back to the buffered `performChatStream` default for any
tool-bearing request (`request.tools.length > 0`): partial tool-call JSON is
unsafe to parse mid-stream, so tool turns never stream token-by-token, in any
adapter. For tool-less requests:

| Adapter | Package | Streaming transport |
|---|---|---|
| Anthropic | `@studnicky/dagonizer-adapter-anthropic` | POSTs `/v1/messages` with `stream: true`; drains the SSE body through `SseLineParser`, dispatching on each frame's `type` (`message_start`, `content_block_delta` → `text_delta`, `message_delta`, `message_stop`). |
| Gemini API | `@studnicky/dagonizer-adapter-gemini-api` | POSTs `streamGenerateContent?alt=sse`; drains the SSE body through `SseLineParser`, decoding each frame's `GeminiResponseBodyType` candidate. |
| Ollama (and the Groq/Cerebras/Mistral/OpenRouter presets) | `@studnicky/dagonizer-adapter-ollama` / `OpenAiCompatibleAdapter` | POSTs `/v1/chat/completions` with `stream: true`; drains the SSE body through `SseLineParser`, reading `delta.content` off each `OpenAiStreamChunkType` frame. |
| Gemini Nano | `@studnicky/dagonizer-adapter-gemini-nano` | In-browser `window.LanguageModel` session's `promptStreaming()` async iterable — no network transport; mode-locked (cumulative vs. incremental chunking) is auto-detected once per session from the first two non-empty chunks. |
| WebLLM | `@studnicky/dagonizer-adapter-web-llm` | The `@mlc-ai/web-llm` engine's own OpenAI-shaped chat-completion stream, opened through the same setup the buffered `performChat` path shares. |

`SseLineParser.linesOf(stream)` is the one shared isomorphic SSE framer
(Web Streams + `TextDecoder`, no `node:*` imports) every fetch-based streaming
adapter drains its provider's response body through — it decodes
`event:`/`data:` lines into `SseFrameType` frames, joining multi-line `data:`
payloads with `\n` per spec.

### `ChatStreamChunk`

```ts twoslash
import type { ChatStreamChunkType } from '@studnicky/dagonizer/adapter';
// ---cut---
const chunk: ChatStreamChunkType = { delta: 'Hello' };
```

One incremental delta — the text fragment produced since the previous chunk.
A streaming adapter yields a sequence of these; concatenating `delta` values
in emission order reconstructs the full response text (which the resolved
`ChatResponseType` already carries in full, independent of the sink).

### Routed streaming: one shared sink, many concurrent runs

An adapter's `sink` argument only ever sees plain `ChatStreamChunkType`
(`{ delta }`) values — adapters have no notion of concurrent runs or which
node/DAG invoked them. `CallModelNode` (in `@studnicky/dagonizer/patterns`)
bridges that gap:

- `CallModelNode`'s constructor accepts `options: { sink?: StreamSinkInterface<RoutedChatStreamChunkType> }`,
  bound once per node instance.
- During each `execute(batch, context)` call, the node wraps `this.sink` in a fresh `RoutingStreamSink`
  (`RoutingStreamSink.of(downstream, routeKey, source)`) and hands that wrapper
  to `adapter.chatStream(request, wrapper)`.
- `routeKey` comes from `CallModelNode.routeKey(state)` — `''` by default (a
  single unrouted stream); a subclass streaming concurrent conversations on a
  shared node instance overrides it to read a per-run id (session, conversation)
  from state.
- Each plain `{ delta }` chunk the adapter pushes becomes a self-describing
  `RoutedChatStreamChunkType` (`{ routeKey, delta, source: { dagName, nodeName } }`)
  at the downstream sink. One shared sink — for example a `StreamChannel`
  feeding a routing DAG that scatters by `routeKey` — demultiplexes concurrent
  runs correctly without a per-run node instance or dispatcher.

```ts twoslash
import { CallModelNode } from '@studnicky/dagonizer/patterns';
import type { LlmAdapterInterface } from '@studnicky/dagonizer/adapter';
import type { ChatRequestType, ChatResponseType, RoutedChatStreamChunkType } from '@studnicky/dagonizer/adapter';
import type { NodeContextType } from '@studnicky/dagonizer/entities';
import type { StreamSinkInterface } from '@studnicky/dagonizer/contracts';
import { NodeStateBase } from '@studnicky/dagonizer';

class ChatState extends NodeStateBase {}

class MyCallModelNode extends CallModelNode<ChatState> {
  readonly name = 'call-model';
  constructor(llm: LlmAdapterInterface, options: { sink?: StreamSinkInterface<RoutedChatStreamChunkType> } = {}) {
    super(llm, options);
  }
  protected override routeKey(_state: ChatState): string {
    return 'conversation-1';
  }
  protected getRequest(_state: ChatState, ctx: NodeContextType): ChatRequestType {
    return {
      'messages':     [],
      'tools':        [],
      'toolChoice':   { 'type': 'auto' },
      'outputSchema': { 'variant': 'none' },
      'maxTokens':    256,
      'temperature':  0,
      'signal':       ctx.signal,
    };
  }
  protected storeResponse(_state: ChatState, _response: ChatResponseType, _ctx: NodeContextType): void { /* write to state */ }
}

const sink: StreamSinkInterface<RoutedChatStreamChunkType> = {
  async push(chunk) { process.stdout.write(`[${chunk.routeKey}] ${chunk.delta}`); },
};
```

See [ReAct agent: live token streaming](../guide/react-agent#live-token-streaming)
and [ReAct agent: routing concurrent streams](../guide/react-agent#routing-concurrent-streams-the-sink-is-a-dag)
for the full walkthrough, and
[the react-agent-memory example](../examples/react-agent-memory) for a
complete working setup.

### Cascades: probe-until-available

`LlmAdapterRegistry` is a process-local map of `(provider, model)` →
zero-arg adapter factory; the factory is invoked fresh on every `resolve()`
call so each caller gets its own retry state and session lifecycle.
`LlmAdapterCascade` walks an ordered preference list against a registry,
`probe()`-ing each resolved adapter in turn, and returns the first one whose
probe resolves `true`. When every preference is exhausted it throws
`LlmError(NO_ADAPTER_AVAILABLE)` with a summary of what was tried.
`LlmAdapterCascade.create(catalogue)` assembles a registry + cascade
pair directly from a data-shaped provider catalogue (no `switch` over
provider names required):

```ts twoslash
import { LlmAdapterCascade } from '@studnicky/dagonizer/adapter';
import type { CatalogueEntryType } from '@studnicky/dagonizer/adapter';

declare const myAdapterFactory: () => import('@studnicky/dagonizer/adapter').LlmAdapterInterface;
declare const selectedModel: string;
// ---cut---
const catalogue: CatalogueEntryType[] = [
  {
    descriptor: { 'provider': 'ollama', 'model': selectedModel, 'capabilities': { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true } },
    factory:    myAdapterFactory,
  },
];
const cascade = LlmAdapterCascade.create(catalogue);
const adapter  = await cascade.select(); // probes in catalogue order
```

See [Example 24: LLM Adapter](../examples/24-llm-adapter) for a complete
async-discovery walkthrough across Ollama and Groq.

### API / export table

All exports below ship through `@studnicky/dagonizer/adapter` unless noted.

| Export | Kind | Purpose |
|---|---|---|
| `LlmAdapterInterface` | type (`./contracts`) | The transport contract every adapter implements. |
| `BaseAdapter` | class | Abstract base: retry, classification, abort+timeout, buffered `performChatStream` default. |
| `BaseAdapterOptionsType` | type | `systemPrompt`, `timeoutMs`, `circuitBreaker`, `tokenBucket`, `timing`, plus `BaseAdapterCoreOptionsType`. |
| `ChatRequestType` / `ChatResponseType` | type | Request/response envelopes passed to `chat()` / `chatStream()`. |
| `ChatStreamChunkType` / `ChatStreamChunk` | type / class | One `{ delta }` streamed fragment, with `ChatStreamChunk.create(...)` as its value factory. |
| `RoutedChatStreamChunkType` / `RoutedChatStreamChunk` | type / class | `{ routeKey, delta, source }` — a chunk stamped for demultiplexing, with `RoutedChatStreamChunk.create(...)` as its value factory. |
| `RoutingStreamSink` | class | Per-execution decorator that stamps plain chunks with `routeKey` + `source`. |
| `StreamSinkInterface<T>` | type (`./contracts`) | Push-side, back-pressured sink contract chunks are delivered to. |
| `SseLineParser` / `SseFrameType` | class / type | Shared isomorphic SSE framer used by every fetch-based streaming adapter. |
| `LlmAdapterRegistry` | class | `(provider, model)` → adapter factory map. |
| `LlmAdapterCascade` | class | Preference-ordered probe-until-available selector. |
| `LlmAdapterCascade` / `CatalogueEntryType` | class / type | Data-driven registry+cascade assembly via `LlmAdapterCascade.create(catalogue)`. |
| `LlmError` / `Classifications` / `LlmErrorReasonType` | class / const / type | Error classification (`NETWORK`, `TIMEOUT`, `QUOTA_EXHAUSTED`, `SCHEMA_VIOLATION`, `CONFIGURATION`, `MODEL_NOT_FOUND`, `NO_ADAPTER_AVAILABLE`, …). |
| `CallModelNode` | class (`./patterns`) | Agent-loop node base: reads a request, calls `adapter.chatStream` through a routed sink, writes the response to state. |

## Details for Nerds

Streaming adapters still resolve to a complete `ChatResponseType`. The sink is an observation channel for incremental chunks, not an alternate return path.

Tool-bearing requests fall back to buffered behavior when partial tool-call JSON would be unsafe to parse mid-stream. A sink rejection is swallowed so UI or SSE delivery failure does not fail an otherwise valid model call.

## Related Concepts

- [Reference: Contracts](./contracts) - `LlmAdapterInterface`, `LlmClientInterface`, and every other adapter contract
- [Guide: ReAct agent](../guide/react-agent) - live token streaming with `CallModelNode { sink }`, routing concurrent runs
- [Example 24: LLM Adapter](../examples/24-llm-adapter) - registry, cascade, and the buffered `chat()` call in a DAG node
- [Example: ReAct agent memory](../examples/react-agent-memory) - working example streaming live tokens through a shared sink
