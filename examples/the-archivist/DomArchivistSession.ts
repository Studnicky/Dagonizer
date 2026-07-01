/**
 * DomArchivistSession: DOM-connected subclass of ArchivistSession.
 *
 * Wires every abstract seam method to the browser UI:
 *   - onGreetingReady / onSampleReplyReady → chat bubbles / input value
 *   - onVisitorTurn / onArchivistTurn → conversation panel
 *   - onRunEnd → IndexedDB durability (HITL park persist or memory n-quads)
 *   - onError → styled error line in the log panel
 *
 * This class is a thin, testable DOM adapter. It owns no DAG logic — all
 * orchestration lives in `ArchivistSession`. Subclassing it with a fake-DOM
 * double lets unit tests exercise HITL park/resume logic without a real browser.
 *
 * HITL resume:
 *   `resumeHitl(humanText)` recalls the checkpoint from `IndexedDbCheckpointStore`,
 *   restores the memory store, and calls the protected `resumeRun()` seam on the
 *   base class. The base class fires `onRunEnd`, which then clears the pending key
 *   and persists the updated memory graph.
 */

import { Checkpoint, CheckpointRestoreAdapter } from '@studnicky/dagonizer/checkpoint';
import { IndexedDbCheckpointStore, IndexedDbStore } from '@studnicky/dagonizer-store-indexeddb';

import type { SessionDagEvent, SessionNodeEvent } from './ArchivistSession.ts';
import { ArchivistSession } from './ArchivistSession.ts';
import type { ArchivistSessionOptions } from './ArchivistSession.ts';
import { ArchivistState } from './ArchivistState.ts';
import { DomConsoleLogger } from './logger/DomConsoleLogger.ts';
import { MemoryStore } from './memory/MemoryStore.ts';
import type { BackendAvailability } from './providers/index.ts';

// ── Module-private UI helpers ─────────────────────────────────────────────────

/** Static factory for chat bubble DOM elements. */
class ChatBubble {
  static visitor(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'bubble bubble-visitor';
    el.textContent = text;
    return el;
  }

  static archivist(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'bubble bubble-archivist';
    el.textContent = text;
    return el;
  }
}

/** Static helpers for the conversation panel: push bubbles and auto-scroll. */
class ConversationView {
  static pushVisitor(container: HTMLDivElement, text: string): void {
    container.appendChild(ChatBubble.visitor(text));
    container.scrollTop = container.scrollHeight;
  }

  static pushArchivist(container: HTMLDivElement, text: string): void {
    container.appendChild(ChatBubble.archivist(text));
    container.scrollTop = container.scrollHeight;
  }
}

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Required DOM element references passed to `DomArchivistSession`.
 *
 * The session drives these elements directly without querying the DOM itself,
 * making the class testable with any object that satisfies the element shapes.
 */
export interface DomArchivistRefs {
  readonly button: HTMLButtonElement;
  readonly input: HTMLInputElement;
  readonly logEl: HTMLPreElement;
  readonly conversationEl: HTMLDivElement;
  readonly hitlBanner: HTMLDivElement;
  readonly hitlInput: HTMLInputElement;
  readonly hitlResumeButton: HTMLButtonElement;
}

/**
 * IndexedDB store pair for HITL and memory durability.
 */
export interface DomArchivistStores {
  readonly kvStore: IndexedDbStore;
  readonly ckptStore: IndexedDbCheckpointStore;
}

/**
 * Constructor options for `DomArchivistSession`.
 *
 * Extends `ArchivistSessionOptions` (which carries `llm`, `conversationContextWindow`,
 * `timeoutSettings`) with the DOM refs and IndexedDB stores this class owns.
 */
export interface DomArchivistSessionOptions extends ArchivistSessionOptions {
  readonly dom: DomArchivistRefs;
  readonly stores: DomArchivistStores;
}

// ── DomArchivistSession ───────────────────────────────────────────────────────

/**
 * DOM-connected Archivist session.
 *
 * Extends `ArchivistSession` and overrides every abstract seam method to drive
 * the browser UI. HITL resume is exposed as a public `resumeHitl()` method
 * so `main.ts` can wire it directly to the HITL resume button.
 */
export class DomArchivistSession extends ArchivistSession {
  readonly #dom: DomArchivistRefs;
  readonly #kvStore: IndexedDbStore;
  readonly #ckptStore: IndexedDbCheckpointStore;

  constructor(store: MemoryStore, logger: DomConsoleLogger, options: DomArchivistSessionOptions) {
    super(store, logger, options);
    this.#dom      = options.dom;
    this.#kvStore  = options.stores.kvStore;
    this.#ckptStore = options.stores.ckptStore;
  }

  // ── Abstract seam overrides ───────────────────────────────────────────────

  protected override onBackendsReady(backends: readonly BackendAvailability[], noModel: boolean): void {
    if (noModel) {
      this.#dom.button.disabled = true;
      this.#dom.input.disabled  = true;
      this.appendErrorLine('No runnable LLM backend detected. Supply ?apiKey= or run Ollama locally.');
    }
    if (backends.length > 0) {
      this.logger.info(`backends detected: ${backends.map((b) => b.id).join(', ')}`);
    }
  }

  protected override onGreetingReady(greeting: string): void {
    ConversationView.pushArchivist(this.#dom.conversationEl, greeting);
  }

  protected override onSampleReplyReady(reply: string): void {
    this.#dom.input.value = reply;
  }

  protected override onVisitorTurn(query: string): void {
    ConversationView.pushVisitor(this.#dom.conversationEl, query);
    this.#dom.input.value = '';
  }

  protected override onArchivistTurn(draft: string): void {
    ConversationView.pushArchivist(this.#dom.conversationEl, draft);
  }

  /**
   * Node events are forwarded to the logger via `SessionObserver`'s parent
   * `ObservedDag`; this override surfaces tool-clone `note` trace entries as
   * additional log lines.
   */
  protected override onNodeEvent(event: SessionNodeEvent): void {
    if (event.trace?.variant === 'note') {
      this.logger.info(event.trace.message);
    }
  }

  /**
   * Flow-start events are no-ops; flow-end durability is handled in `onRunEnd`
   * to avoid double-persisting (both `onDagEvent` and `onRunEnd` fire with the
   * same `flowEnd` payload).
   */
  protected override onDagEvent(event: SessionDagEvent): void {
    if (event.kind === 'flowStart') {
      this.logger.info(`dag: ${event.dagName} started`);
    }
  }

  /**
   * Run-end handler: persists checkpoint on HITL park, or persists the memory
   * n-quads on completed/cancelled runs. Re-enables the submit button.
   *
   * `onRunEnd` and `onDagEvent({ kind: 'flowEnd' })` fire with the same payload;
   * durability lives here so `onDagEvent` stays a no-op for `flowEnd`.
   */
  protected override onRunEnd(event: Extract<SessionDagEvent, { kind: 'flowEnd' }>): void {
    this.#dom.button.disabled = false;
    void this.#persistAfterRun(event);
  }

  protected override onMemoryChanged(): void {
    // No live memory graph in the standalone DOM demo.
  }

  protected override onError(error: Error): void {
    this.#dom.button.disabled = false;
    this.appendErrorLine(error.message !== '' ? error.message : String(error));
  }

  // ── HITL resume ──────────────────────────────────────────────────────────

  /**
   * Resume a parked flow with the visitor's reply text.
   *
   * Recalls the checkpoint, restores the memory store, and delegates to the
   * base-class `resumeRun()` which fires all node events and `onRunEnd` exactly
   * as a fresh `ask()` run does. `onRunEnd` then persists the completed memory
   * graph and hides the HITL banner.
   */
  async resumeHitl(humanText: string): Promise<void> {
    this.#dom.hitlResumeButton.disabled = true;
    try {
      const pendingKey = await this.#kvStore.get('hitl:pendingKey');
      if (typeof pendingKey !== 'string' || pendingKey.length === 0) {
        this.appendErrorLine('No pending HITL checkpoint found.');
        return;
      }
      const recalled = await Checkpoint.recall(this.#ckptStore, pendingKey);
      if (recalled === null) {
        this.appendErrorLine(`Checkpoint '${pendingKey}' not found in store.`);
        return;
      }
      await recalled.restoreStores({ 'memory': this.store });
      const { dagName, state, cursor } = recalled.restoreState(
        CheckpointRestoreAdapter.wrap((snap) => ArchivistState.restore(snap)),
      );
      state.query = humanText;
      this.#dom.hitlInput.value = '';
      ConversationView.pushVisitor(this.#dom.conversationEl, humanText);
      await this.resumeRun(humanText, dagName, state, cursor);
    } catch (err) {
      this.appendErrorLine(err instanceof Error ? err.message : String(err));
    } finally {
      this.#dom.hitlResumeButton.disabled = false;
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Append a styled error line to the log panel. */
  appendErrorLine(message: string): void {
    const line = document.createElement('span');
    line.className = 'error';
    line.textContent = `[error] ${message}\n`;
    this.#dom.logEl.appendChild(line);
    this.#dom.logEl.scrollTop = this.#dom.logEl.scrollHeight;
  }

  async #persistAfterRun(event: Extract<SessionDagEvent, { kind: 'flowEnd' }>): Promise<void> {
    if (event.execution.parked !== null) {
      // Flow parked — persist checkpoint and show the HITL banner.
      try {
        const ckpt = await Checkpoint.capture(event.dagName, event.execution, { 'stores': { 'memory': this.store } });
        await ckpt.persist(this.#ckptStore, event.execution.parked.correlationKey);
        await this.#kvStore.set('hitl:pendingKey', event.execution.parked.correlationKey);
        this.#dom.hitlBanner.style.display = 'flex';
      } catch (err) {
        this.appendErrorLine(`HITL persist failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // Completed run — persist the memory n-quads and clear the pending key.
      try {
        const snap = await this.store.snapshot();
        const nquadsEntry = snap.entries.find((e) => e.key === 'nquads');
        if (typeof nquadsEntry?.value === 'string') {
          await this.#kvStore.set('memory:nquads', nquadsEntry.value);
        }
        await this.#kvStore.delete('hitl:pendingKey');
        this.#dom.hitlBanner.style.display = 'none';
      } catch (err) {
        this.appendErrorLine(`Memory persist failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
