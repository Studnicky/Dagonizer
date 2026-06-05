/**
 * BookEntitiesError: base error for the book-entities package.
 */
export class BookEntitiesError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BookEntitiesError';
  }
}
