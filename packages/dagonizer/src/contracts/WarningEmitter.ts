/**
 * WarningEmitter: typed contract for emitting diagnostic warnings.
 *
 * Wave 4 will replace the `onWarning: (message: string) => void` callbacks
 * in `ContractRegistryValidator` and `onContractWarning` call sites with
 * this contract, converting callback seams to injectable adapters.
 */
export interface WarningEmitter {
  warn(message: string): void;
}
