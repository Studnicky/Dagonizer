/** Scoped write authority for a shared graph transfer. */
export type GraphStateTransferLeaseType = {
  readonly endpoint: string;
  readonly token: string;
  readonly graphIris: string[];
  readonly expiresAt: number;
};
