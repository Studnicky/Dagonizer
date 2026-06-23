/**
 * DispatcherLlmClient: DispatcherLlmInterface backed by any LlmAdapterInterface.
 *
 * classify() — asks the LLM to output a single word: routine, escalate, or off-topic.
 * compose()  — generates a concise support reply (≤3 sentences) using recent
 *              conversation history as context.
 *
 * Both calls pass the AbortSignal through so the DAG's cancellation mechanism
 * propagates to in-flight HTTP requests.
 */

import { ChatRequestBuilder } from '@studnicky/dagonizer/adapter';
import type { LlmAdapterInterface, ChatResponseMessageType } from '@studnicky/dagonizer/adapter';

import type { ConversationTurnType } from '../DispatcherState.ts';
import type { DispatcherLlmInterface } from '../services.ts';

const SYSTEM_CLASSIFY = `You are a customer support classifier for Noocodex, an online bookstore.
Classify the customer message as exactly one of:
  routine   — general questions about orders, products, store hours, availability
  escalate  — refunds, billing disputes, account issues, complaints, angry tone, urgent requests
  off-topic — unrelated to books or the bookstore; blank messages

Reply with a single word: routine, escalate, or off-topic.`;

const SYSTEM_SUPPORT = `You are a helpful customer support agent for Noocodex, an online bookstore.
Be concise, friendly, and professional. If you cannot help, say so clearly and offer to escalate.
Keep responses under 3 sentences.`;

export class DispatcherLlmClient implements DispatcherLlmInterface {
  readonly #adapter: LlmAdapterInterface;

  constructor(adapter: LlmAdapterInterface) {
    this.#adapter = adapter;
  }

  async classify(
    message: string,
    conversation: readonly ConversationTurnType[],
    signal?: AbortSignal,
  ): Promise<'routine' | 'escalate' | 'off-topic'> {
    const recentHistory = conversation.slice(-4);
    const contextBlock = recentHistory.length > 0
      ? `\n\nRecent conversation:\n${recentHistory.map((t) => `[${t.role}] ${t.text}`).join('\n')}`
      : '';

    const request = ChatRequestBuilder.from({
      'messages': [
        {
          'role':    'user',
          'content': `${SYSTEM_CLASSIFY}${contextBlock}\n\nMessage to classify: ${message}`,
        },
      ],
      'temperature': 0,
      'maxTokens':   8,
      ...(signal !== undefined ? { 'signal': signal } : {}),
    });

    const response = await this.#adapter.chat(request);
    const raw = DispatcherLlmClient.contentOf(response.message).toLowerCase().trim();
    if (raw.includes('escalate')) return 'escalate';
    if (raw.includes('off') || raw.includes('topic') || message.trim().length === 0) return 'off-topic';
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
        { 'role': 'user', 'content': SYSTEM_SUPPORT },
        ...history,
        { 'role': 'user', 'content': message },
      ],
      'temperature': 0.4,
      'maxTokens':   120,
      ...(signal !== undefined ? { 'signal': signal } : {}),
    });

    const response = await this.#adapter.chat(request);
    return DispatcherLlmClient.contentOf(response.message).trim();
  }

  private static contentOf(message: ChatResponseMessageType): string {
    return message.variant === 'tools' ? '' : message.content;
  }
}
