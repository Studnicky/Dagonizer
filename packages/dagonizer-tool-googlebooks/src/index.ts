export { GoogleBooksTool } from './GoogleBooksTool.js';

// Re-export shared entity types + CanonicalId for ergonomics; consumers
// can `import { CanonicalId, type Candidate } from '@noocodex/dagonizer-tool-googlebooks'`
// without also installing @noocodex/dagonizer-book-entities directly.
export type { Book, Candidate, Money } from '@noocodex/dagonizer-book-entities';
export { CanonicalId } from '@noocodex/dagonizer-book-entities';
