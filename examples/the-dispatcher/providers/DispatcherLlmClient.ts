/**
 * DispatcherLlmClient: DispatcherLlmInterface backed by any LlmAdapterInterface.
 *
 * Extends BaseLlmService for the adapter-wrapping boilerplate (text() / chat() helpers,
 * contentOf() extractor). Domain logic — the prompts and output parsing — lives here.
 *
 * classify() — asks the LLM to output a single word: routine, escalate, or off-topic.
 * compose()  — generates a concise support reply (≤3 sentences) using recent
 *              conversation history as context, in the visitor's device language.
 *
 * Both calls pass the AbortSignal through so the DAG's cancellation mechanism
 * propagates to in-flight HTTP requests.
 */

import { BaseLlmService } from '@studnicky/dagonizer/adapter';
import type { LlmAdapterInterface } from '@studnicky/dagonizer/adapter';
import { ChatRequestBuilder } from '@studnicky/dagonizer/adapter';

import type { ConversationTurnType } from '../DispatcherState.ts';
import type { DispatcherLlmInterface } from '../services.ts';
import { UserLanguage } from '../language/UserLanguage.ts';

const SYSTEM_CLASSIFY = `You are a customer support classifier for Noocodex, an online bookstore.
Classify the customer message as exactly one of:
  routine   — general questions about orders, products, store hours, availability
  escalate  — refunds, billing disputes, account issues, complaints, angry tone, urgent requests
  off-topic — unrelated to books or the bookstore; blank messages

Reply with a single word: routine, escalate, or off-topic.`;

const SYSTEM_SUPPORT = `You are a helpful customer support agent for Noocodex, an online bookstore.
Be concise, friendly, and professional. If you cannot help, say so clearly and offer to escalate.
Keep responses under 3 sentences.`;

/**
 * Construction options for `DispatcherLlmClient`. `language` is the
 * visitor's device language (ISO 639-1), threaded into the compose system
 * prompt so replies come back in the visitor's own language. Defaulted to
 * `'en'` when absent so existing callers stay correct.
 */
export interface DispatcherLlmClientOptions {
  readonly language?: string;
}

export class DispatcherLlmClient extends BaseLlmService implements DispatcherLlmInterface {
  /** Visitor device language; passed to the compose system prompt. */
  readonly language: string;

  constructor(adapter: LlmAdapterInterface, options: DispatcherLlmClientOptions = {}) {
    super(adapter);
    this.language = options.language !== undefined && options.language.length > 0
      ? options.language
      : 'en';
  }

  async classify(
    message: string,
    conversation: readonly ConversationTurnType[],
    signal?: AbortSignal,
  ): Promise<'routine' | 'escalate' | 'off-topic'> {
    const contextBlock = conversation.length > 0
      ? `\n\nRecent conversation:\n${conversation.slice(-4).map((t) => `[${t.role}] ${t.text}`).join('\n')}`
      : '';

    const raw = await this.text(
      `${SYSTEM_CLASSIFY}${contextBlock}\n\nMessage to classify: ${message}`,
      { 'temperature': 0, 'maxTokens': 8, ...(signal !== undefined ? { signal } : {}) },
    );

    const lower = raw.toLowerCase().trim();
    if (lower.includes('escalate')) return 'escalate';
    if (lower.includes('off') || lower.includes('topic') || message.trim().length === 0) return 'off-topic';
    return 'routine';
  }

  async compose(
    message: string,
    conversation: readonly ConversationTurnType[],
    signal?: AbortSignal,
  ): Promise<string> {
    const history = conversation.slice(-6).map((t) => ({
      'role':    (t.role === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant',
      'content': t.text,
    }));

    const request = ChatRequestBuilder.from({
      'messages': [
        { 'role': 'user', 'content': DispatcherLlmClient.systemSupport(this.language) },
        ...history,
        { 'role': 'user', 'content': message },
      ],
      'temperature': 0.4,
      'maxTokens':   120,
      ...(signal !== undefined ? { 'signal': signal } : {}),
    });

    const msg = await this.chat(request);
    return BaseLlmService.contentOf(msg).trim();
  }

  /**
   * Prepend a language directive to `SYSTEM_SUPPORT` so composed replies
   * come back in the visitor's device language rather than always English.
   */
  private static systemSupport(language: string): string {
    const code = UserLanguage.normalize(language);
    const name = UserLanguage.displayName(code);
    return `${SYSTEM_SUPPORT}\nRespond in ${name} (${code}).`;
  }

  async warm(signal?: AbortSignal): Promise<void> {
    try {
      await this.text('ok', { 'maxTokens': 1, 'temperature': 0, ...(signal !== undefined ? { 'signal': signal } : {}) });
    } catch {
      // Best-effort: a warm-up failure must never surface to the caller.
    }
  }
}
