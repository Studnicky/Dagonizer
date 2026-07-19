interface RestoredContextSource<TRecord> {
  clear(): Promise<void> | void;
  load(): Promise<TRecord | null> | TRecord | null;
}

type RestoredContextResult<TValue> =
  | { readonly variant: 'missing' }
  | { readonly variant: 'restored'; readonly value: TValue }
  | { readonly variant: 'cleared'; readonly error: Error };

export class RestoredContextRecovery {
  static async restore<TRecord, TValue>(
    source: RestoredContextSource<TRecord>,
    restore: (record: TRecord) => Promise<TValue> | TValue,
  ): Promise<RestoredContextResult<TValue>> {
    const record = await source.load();
    if (record === null) {
      return { 'variant': 'missing' };
    }

    try {
      return {
        'variant': 'restored',
        'value': await restore(record),
      };
    } catch (error) {
      await source.clear();
      return {
        'variant': 'cleared',
        'error': error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
