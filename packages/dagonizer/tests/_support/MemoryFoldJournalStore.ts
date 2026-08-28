import type { FoldJournalStoreInterface } from '../../src/contracts/FoldJournalStoreInterface.js';

export class MemoryFoldJournalStore implements FoldJournalStoreInterface {
  readonly #commits = new Map<string, FoldJournalStoreInterface.CommitType[]>();
  readonly #commitIds = new Map<string, Set<string>>();
  appendCount = 0;
  failNextAppend = false;

  async append(runIri: string, commit: FoldJournalStoreInterface.CommitType): Promise<void> {
    this.appendCount++;
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error('simulated fold journal append failure');
    }
    const commitIds = this.#commitIds.get(runIri) ?? new Set<string>();
    if (commitIds.has(commit.commitId)) return;
    const commits = this.#commits.get(runIri) ?? [];
    commits.push(structuredClone(commit));
    commitIds.add(commit.commitId);
    this.#commits.set(runIri, commits);
    this.#commitIds.set(runIri, commitIds);
  }

  async *read(runIri: string): AsyncIterable<FoldJournalStoreInterface.CommitType> {
    for (const commit of this.#commits.get(runIri) ?? []) {
      yield structuredClone(commit);
    }
  }
}
