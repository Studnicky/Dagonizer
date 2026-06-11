/**
 * GroqApiAdapter: Groq REST adapter.
 *
 * Llama 3.3 70B on Groq's LPU hardware. Free tier ~30 RPM. Uses
 * `max_completion_tokens` (Groq does not accept `max_tokens`).
 */

import { OpenAiCompatibleAdapter } from '@noocodex/dagonizer/adapter';
import type { OpenAiCompatibleAdapterOptions } from '@noocodex/dagonizer/adapter';

export class GroqApiAdapter extends OpenAiCompatibleAdapter {
  constructor(apiKey: string, options: OpenAiCompatibleAdapterOptions = {}) {
    super(
      apiKey,
      {
        'id':            'groq',
        'displayName':   'Groq (llama-3.3-70b)',
        'capabilities':  { 'toolUse': 'full', 'structuredOutput': true, 'jsonMode': true },
        'endpoint':      'https://api.groq.com/openai/v1/chat/completions',
        'defaultModel':  'llama-3.3-70b-versatile',
        'tokenField':    'max_completion_tokens',
        'extraHeaders':  {},
      },
      options,
    );
  }
}
