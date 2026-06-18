/**
 * Logger barrel: `ConsoleLogger` (CLI sink) + `DomConsoleLogger` (browser
 * surface) and the event/level types.
 */

export { ConsoleLogger } from './ConsoleLogger.ts';
export type { LogEvent, LogLevel } from './ConsoleLogger.ts';
export { DomConsoleLogger } from './DomConsoleLogger.ts';
export type { LogPanelHost } from './DomConsoleLogger.ts';
