# @studnicky/dagonizer-patterns-rag

LLM-driven node pattern bases for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer). Each pattern is an abstract class consumers extend to inject domain-specific prompts, state shape, and routing.

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-patterns-rag
```

## Taxonomy

```
MonadicNode<TState, TOutput, TServices>     (root: main package's ./patterns)
├── DecisionNode<TState, TChoice>           (LLM picks a structured choice)
│   ├── ClassifyIntentNode<TState, TIntent>
│   ├── DecideToolsNode<TState>
│   ├── ValidateResponseNode<TState>
│   └── RankCandidatesNode<TState>
├── ComposeNode<TState>                      (LLM produces prose)
│   ├── ComposeResponseNode<TState>
│   ├── ComposeEmptyResponseNode<TState>
│   ├── ComposeMemoryResponseNode<TState>
│   └── DeclineNode<TState>
└── ScoutNode<TState, TIn, TOut, TItem>     (calls a Tool, normalises, writes back)
```

## Services contract

Every pattern in this package expects `services.llm: LlmClient` (any `LlmAdapter` satisfies it).

```ts
import type { RagServices } from '@studnicky/dagonizer-patterns-rag';
```

## Worked example: extending ClassifyIntentNode

```ts
import { ClassifyIntentNode } from '@studnicky/dagonizer-patterns-rag';
import { NodeStateBase } from '@studnicky/dagonizer';

type Intent = 'search' | 'describe' | 'recommend' | 'off-topic';

class MyState extends NodeStateBase {
  query = '';
  intent: Intent = 'off-topic';
}

class IntentClassifier extends ClassifyIntentNode<MyState, Intent> {
  readonly name = 'classify-intent';
  readonly outputs = ['search', 'describe', 'recommend', 'off-topic'] as const;

  protected buildPrompt(s: MyState): string {
    return `Classify: "${s.query}" → search | describe | recommend | off-topic. Reply with one word.`;
  }
  protected parseChoice(content: string): Intent {
    const t = content.trim().toLowerCase();
    if (t === 'search' || t === 'describe' || t === 'recommend') return t;
    return 'off-topic';
  }
  protected routeFor(intent: Intent): Intent { return intent; }
  protected applyChoice(s: MyState, intent: Intent): void { s.intent = intent; }
}
```

The base handles LLM dispatch, retry, abort propagation, and routing. Your subclass writes ~15 lines.

## Pattern reference

| Pattern | TChoice | Output ports | Override |
|---|---|---|---|
| `DecisionNode<TState, TChoice>` | any | any | `buildPrompt`, `parseChoice`, `routeFor`, `applyChoice` |
| `ClassifyIntentNode<TState, TIntent>` | `TIntent ∈ string union` | each intent token | same as parent |
| `DecideToolsNode<TState>` | `readonly ToolCall[]` | `'planned' | 'skip'` | same as parent |
| `ValidateResponseNode<TState>` | `'yes' | 'no'` | `'approved' | 'retry'` | same as parent |
| `RankCandidatesNode<TState>` | `readonly Score[]` | `'ranked' | 'empty'` | same as parent |
| `ComposeNode<TState>` | n/a (prose) | `'success'` | `buildPrompt`, `applyDraft` |
| `ComposeResponseNode<TState>` | n/a | `'success'` | same as parent |
| `ComposeEmptyResponseNode<TState>` | n/a | `'success'` | same as parent |
| `ComposeMemoryResponseNode<TState>` | n/a | `'success'` | same as parent |
| `DeclineNode<TState>` | n/a | `'success'` | same as parent |
| `ScoutNode<TState, TIn, TOut, TItem>` | n/a | `'success' | 'empty' | 'error'` | `buildInput`, `normalize`, `writeBack` |

## License

MIT
