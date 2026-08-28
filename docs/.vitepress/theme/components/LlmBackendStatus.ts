import type { ProviderId } from '../../../../examples/the-archivist/providers/index.ts';

const SLOW_MODEL_IDS: readonly ProviderId[] = ['gemini-nano', 'web-llm'];

export class LlmBackendStatus {
  static warning(activeId: ProviderId | null): string | null {
    if (activeId === null || !SLOW_MODEL_IDS.includes(activeId)) return null;
    return 'Slow model selected. Browser-local models can take significantly longer to load and complete structured-output steps than cloud backends. Select a configured cloud backend in this tab for faster responses.';
  }
}
