/**
 * WarningEmitter: typed contract for emitting diagnostic warnings.
 *
 * `ContractRegistryValidator` and warning-emitting call sites accept a
 * `WarningEmitter` so consumers can inject any sink (logger, accumulator,
 * no-op) without a callback seam.
 */
export interface WarningEmitter {
  warn(message: string): void;
}
