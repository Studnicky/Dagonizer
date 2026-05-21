/** Constructor type constraint for `retryOn` / `abortOn` error lists. */
export type ErrorConstructorType = new (...args: never[]) => Error;
