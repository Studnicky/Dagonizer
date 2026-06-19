/**
 * MistralApiAdapter: Mistral la Plateforme REST adapter.
 *
 * `mistral-small-latest`. Uses `max_tokens` (Mistral follows the
 * original OpenAI spec, not the newer `max_completion_tokens`).
 */

import { OpenAiCompatibleAdapter } from '@studnicky/dagonizer/adapter';
import type { OpenAiCompatibleAdapterOptionsType } from '@studnicky/dagonizer/adapter';

export class MistralApiAdapter extends OpenAiCompatibleAdapter {
  constructor(apiKey: string, options: OpenAiCompatibleAdapterOptionsType = {}) {
    super(
      apiKey,
      {
        'id':            'mistral',
        'displayName':   'Mistral (mistral-small)',
        'capabilities':  { 'toolUse': 'full', 'structuredOutput': true, 'jsonMode': true },
        'endpoint':      'https://api.mistral.ai/v1/chat/completions',
        'defaultModel':  'mistral-small-latest',
        'tokenField':    'max_tokens',
        'extraHeaders':  {},
      },
      options,
    );
  }
}
