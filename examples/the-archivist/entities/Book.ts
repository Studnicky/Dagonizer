/**
 * Book: the catalog record vocabulary the assistant operates on.
 *
 * Re-exports the composed entity shape from `@noocodex/dagonizer-book-entities`
 * so archivist modules import from one local path rather than the package
 * directly. The source of truth for the shape is the package; this file
 * is a transparent re-export.
 */

export type {
  Book,
  BookAvailability,
  BookIdentity,
  BookInput,
  BookPublication,
  Candidate,
  Money,
} from '@noocodex/dagonizer-book-entities';
export { BookBuilder } from '@noocodex/dagonizer-book-entities';
