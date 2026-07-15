#!/usr/bin/env node
/** Decode canonical N-Quads into JSON RDF terms for inspection or migration. */

import { readFileSync } from 'node:fs';

import { GraphStateTransferCodec } from '../dist/index.js';

const inputPath = process.argv[2];
const input = inputPath === undefined ? readFileSync(0, 'utf8') : readFileSync(inputPath, 'utf8');
process.stdout.write(`${JSON.stringify(GraphStateTransferCodec.decode(input), null, 2)}\n`);
