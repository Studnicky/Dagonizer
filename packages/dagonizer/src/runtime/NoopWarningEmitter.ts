import type { WarningEmitter } from '../contracts/WarningEmitter.js';

/**
 * No-op base; the default `WarningEmitter` for call sites that do not
 * need to surface contract warnings. Plugins and derived dispatchers that
 * want to capture warnings pass a concrete `WarningEmitter` implementation
 * instead.
 */
export class NoopWarningEmitter implements WarningEmitter {
  warn(_message: string): void { /* no-op */ }
}
