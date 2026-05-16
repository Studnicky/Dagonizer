/**
 * Shared Ajv 2020-12 instance for every entity validator in the package.
 * Compiling the meta-schema once and reusing the instance keeps memory
 * flat and lets cross-schema `$ref`s resolve through one registry when
 * we add them.
 */

import { Ajv2020 } from 'ajv/dist/2020.js';

/** Shared Ajv 2020-12 instance. Every entity validator compiles against this. */
export const sharedAjv = new Ajv2020({ 'allErrors': true, 'strict': false });
